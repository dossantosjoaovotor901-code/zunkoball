/* game.js - lógica do jogo: estado, telas, entrada, física, IA, áudio e desenho (ver README.md) */
        /* Atalho para document.getElementById */
        const $ = id => document.getElementById(id);
        const order = ['classic'];
        /* ===== SEÇÃO 1 - ESTADO GLOBAL ===== */
        let mode = 'local'
          , mapKey = 'v3'
          , fieldVariant = 'v3'
          , engine = null
          , spectatorMode = false
          , teamWindowFromGame = false
          , teamWindowWasPaused = false
          , settingsReturnScreen = 'lobbyScreen'
          , activeKeyBinding = null;
        const state = {
            nick: localStorage.getItem('mb_classic_nick') || 'Jogador',
            avatar: localStorage.getItem('mb_classic_avatar') || 'P1',
            roomMode: localStorage.getItem('mb_room_mode') || 'local',
            settings: JSON.parse(localStorage.getItem('mb_settings') || 'null') || {
                sound: 'on',
                player: '1',
                gamepad: 'dynamic',
                kick: 'static',
                size: 'medium',
                pos: 'left',
                keyboard: 'on',
                shout: 'on',
                hideMobileControls: false
            }
        };
        const graphicsDefaults = {
            preset: 'balanced',
            renderScale: 100,
            fpsLimit: 0,
            showBallGuide: true,
            showGoalSprites: true,
            showPlayerShadows: true,
            ball3d: true
        };
        function readGraphicsSettings() {
            try {
                const saved = JSON.parse(localStorage.getItem('mb_graphics') || '{}');
                const settings = { ...graphicsDefaults, ...saved };
                if (!['low', 'balanced', 'high', 'custom'].includes(settings.preset))
                    settings.preset = graphicsDefaults.preset;
                settings.renderScale = Math.max(60, Math.min(125, Number(settings.renderScale) || 100));
                settings.fpsLimit = [0, 30, 45, 60, 90, 120].includes(Number(settings.fpsLimit)) ? Number(settings.fpsLimit) : 0;
                settings.showBallGuide = settings.showBallGuide !== false;
                settings.showGoalSprites = settings.showGoalSprites !== false;
                settings.showPlayerShadows = settings.showPlayerShadows !== false;
                settings.ball3d = settings.ball3d !== false;
                return settings
            } catch (error) {
                console.warn('Não foi possível carregar as configurações gráficas:', error);
                return { ...graphicsDefaults }
            }
        }
        const graphicsSettings = readGraphicsSettings();
        function saveGraphicsSettings() {
            try {
                localStorage.setItem('mb_graphics', JSON.stringify(graphicsSettings))
            } catch (error) {
                console.error('Não foi possível salvar as configurações gráficas:', error)
            }
        }
        function syncGraphicsControls() {
            $('graphicsPreset').value = graphicsSettings.preset;
            $('renderScale').value = graphicsSettings.renderScale;
            $('renderScaleValue').value = `${graphicsSettings.renderScale}%`;
            $('renderScaleValue').textContent = `${graphicsSettings.renderScale}%`;
            $('fpsLimit').value = String(graphicsSettings.fpsLimit);
            $('showBallGuide').checked = graphicsSettings.showBallGuide;
            $('showGoalSprites').checked = graphicsSettings.showGoalSprites;
            $('showPlayerShadows').checked = graphicsSettings.showPlayerShadows;
            if ($('ballStyle3d'))
                $('ballStyle3d').value = graphicsSettings.ball3d ? '3d' : '2d'
        }
        function applyGraphicsPreset(preset) {
            graphicsSettings.preset = preset;
            if (preset === 'low') {
                graphicsSettings.renderScale = 65;
                graphicsSettings.fpsLimit = 30;
                graphicsSettings.showBallGuide = false;
                graphicsSettings.showGoalSprites = false;
                graphicsSettings.showPlayerShadows = false;
                graphicsSettings.ball3d = false
            } else if (preset === 'balanced') {
                graphicsSettings.renderScale = 100;
                graphicsSettings.fpsLimit = 0;
                graphicsSettings.showBallGuide = true;
                graphicsSettings.showGoalSprites = true;
                graphicsSettings.showPlayerShadows = true;
                graphicsSettings.ball3d = true
            } else if (preset === 'high') {
                graphicsSettings.renderScale = 125;
                graphicsSettings.fpsLimit = 0;
                graphicsSettings.showBallGuide = true;
                graphicsSettings.showGoalSprites = true;
                graphicsSettings.showPlayerShadows = true;
                graphicsSettings.ball3d = true
            }
            syncGraphicsControls();
            saveGraphicsSettings();
            if (engine)
                resize()
        }
        function updateGraphicsSettingsFromControls() {
            graphicsSettings.preset = 'custom';
            graphicsSettings.renderScale = +$('renderScale').value;
            graphicsSettings.fpsLimit = +$('fpsLimit').value;
            graphicsSettings.showBallGuide = $('showBallGuide').checked;
            graphicsSettings.showGoalSprites = $('showGoalSprites').checked;
            graphicsSettings.showPlayerShadows = $('showPlayerShadows').checked;
            if ($('ballStyle3d'))
                graphicsSettings.ball3d = $('ballStyle3d').value === '3d';
            syncGraphicsControls();
            saveGraphicsSettings();
            if (engine)
                resize()
        }
        const gameChatDefaults = {
            enabled: true,
            width: 340,
            opacity: 0.76,
            x: 2,
            y: 72
        };
        function readGameChatSettings() {
            try {
                const saved = JSON.parse(localStorage.getItem('mb_game_chat') || '{}');
                const settings = {
                    ...gameChatDefaults,
                    ...saved
                };
                settings.enabled = settings.enabled !== false;
                settings.width = Math.max(220, Math.min(500, Number(settings.width) || gameChatDefaults.width));
                settings.opacity = Math.max(.2, Math.min(1, Number(settings.opacity) || gameChatDefaults.opacity));
                settings.x = Math.max(0, Math.min(100, Number(settings.x) || 0));
                settings.y = Math.max(0, Math.min(100, Number(settings.y) || 0));
                return settings
            } catch (error) {
                console.warn('Não foi possível carregar as configurações do chat:', error);
                return { ...gameChatDefaults }
            }
        }
        const gameChatSettings = readGameChatSettings();
        function saveGameChatSettings() {
            try {
                localStorage.setItem('mb_game_chat', JSON.stringify(gameChatSettings))
            } catch (error) {
                console.error('Não foi possível salvar as configurações do chat:', error)
            }
        }
        function applyGameChatSettings() {
            const chat = $('gameChat');
            if (!chat)
                return;
            chat.classList.toggle('chatDisabled', !gameChatSettings.enabled);
            chat.style.setProperty('--game-chat-width', `${gameChatSettings.width}px`);
            chat.style.setProperty('--game-chat-opacity', gameChatSettings.opacity);
            const game = $('game');
            const maxLeft = Math.max(0, game.clientWidth - chat.offsetWidth);
            const maxTop = Math.max(0, game.clientHeight - chat.offsetHeight);
            chat.style.left = `${maxLeft * gameChatSettings.x / 100}px`;
            chat.style.top = `${maxTop * gameChatSettings.y / 100}px`;
            chat.style.right = 'auto';
            chat.style.bottom = 'auto'
        }
        function syncGameChatSettings() {
            $('pageChatEnabled').checked = gameChatSettings.enabled;
            $('pageChatWidth').value = gameChatSettings.width;
            $('pageChatOpacity').value = gameChatSettings.opacity;
            $('pageChatX').value = gameChatSettings.x;
            $('pageChatY').value = gameChatSettings.y;
            applyGameChatSettings()
        }
        const keyBindingDefaults = {
            up: 'w',
            down: 's',
            left: 'a',
            right: 'd',
            kick: 'x',
            pass: 'c'
        };
        function readKeyBindings() {
            try {
                return {
                    ...keyBindingDefaults,
                    ...JSON.parse(localStorage.getItem('mb_key_bindings') || '{}')
                }
            } catch (error) {
                console.warn('Não foi possível carregar as teclas salvas:', error);
                return { ...keyBindingDefaults }
            }
        }
        const keyBindings = readKeyBindings();
        const customizationDefaults = {
            dark: false,
            themeColor: '#7040b5',
            lineColor: '#ffffff',
            ballColor: '#ffffff',
            ballImage: '',
            ballZoom: 100,
            ballX: 50,
            ballY: 50,
            playerImage: '',
            playerZoom: 100,
            playerX: 50,
            playerY: 50,
            playerUniform: 'normal',
            ballUniform: 'normal'
        };
        // Uniformes disponíveis (cores e padrões próprios). 'normal' = aparência padrão do jogo.
        const UNIFORMS = [
            { id: 'verde-listras', name: 'Listras verdes', pattern: 'stripes', base: '#ffffff', accent: '#1f9d55', text: '#0b3d1f', textStroke: 'rgba(255,255,255,.9)' },
            { id: 'azul-listras', name: 'Listras azuis', pattern: 'stripes', base: '#ffffff', accent: '#2563eb', text: '#0b1f5c', textStroke: 'rgba(255,255,255,.9)' },
            { id: 'roxo-ouro', name: 'Roxo e ouro', pattern: 'halves', base: '#6d28d9', accent: '#f6c945', text: '#ffffff' },
            { id: 'faixa', name: 'Faixa diagonal', pattern: 'sash', base: '#111111', accent: '#ef4444', text: '#ffffff' },
            { id: 'laranja-aros', name: 'Aros laranja', pattern: 'hoops', base: '#fb923c', accent: '#1f2937', text: '#ffffff' },
            { id: 'xadrez', name: 'Xadrez', pattern: 'checker', base: '#ffffff', accent: '#111111', text: '#e11d48', textStroke: 'rgba(255,255,255,.95)' },
            { id: 'dourado', name: 'Dourado', pattern: 'solid', base: '#f6c945', accent: '#f6c945', text: '#3b2a00', textStroke: 'rgba(255,255,255,.7)' },
            { id: 'rosa', name: 'Rosa', pattern: 'solid', base: '#ec4899', accent: '#ec4899', text: '#ffffff' },
            { id: 'ciano-metade', name: 'Ciano e preto', pattern: 'halves', base: '#06b6d4', accent: '#0f172a', text: '#ffffff' },
            { id: 'branco', name: 'Branco', pattern: 'solid', base: '#f8fafc', accent: '#f8fafc', text: '#111111', textStroke: 'rgba(255,255,255,.9)' }
        ];
        /* Bolas 3D prontas (gomos, costuras, brilho) - todas podem ser modificadas em "Personalizar" */
        const BALL_PRESETS = [
            { id: 'b-classica', name: 'Clássica', pattern: 'classic', base: '#ffffff', accent: '#15171a', line: '#2b2f36', gloss: 70 },
            { id: 'b-ouro', name: 'Ouro', pattern: 'classic', base: '#f6c945', accent: '#6b3f00', line: '#b8860b', gloss: 92 },
            { id: 'b-gelo', name: 'Gelo', pattern: 'classic', base: '#e0f2fe', accent: '#0ea5e9', line: '#7dd3fc', gloss: 95 },
            { id: 'b-praia', name: 'Praia', pattern: 'wedges', base: '#ef4444', accent: '#3b82f6', line: '#facc15', gloss: 55 },
            { id: 'b-basquete', name: 'Basquete', pattern: 'seams', base: '#f97316', accent: '#f97316', line: '#1f1308', gloss: 22 },
            { id: 'b-volei', name: 'Vôlei', pattern: 'wedges', base: '#facc15', accent: '#2563eb', line: '#ffffff', gloss: 45 },
            { id: 'b-fogo', name: 'Fogo', pattern: 'gradient', base: '#b91c1c', accent: '#fde047', line: '#000000', gloss: 60 },
            { id: 'b-galaxia', name: 'Galáxia', pattern: 'dots', base: '#1e1b4b', accent: '#a78bfa', line: '#000000', gloss: 88 },
            { id: 'b-cromada', name: 'Cromada', pattern: 'checker', base: '#e2e8f0', accent: '#475569', line: '#000000', gloss: 100 },
            { id: 'b-neon', name: 'Neon', pattern: 'hoops', base: '#111827', accent: '#22d3ee', line: '#000000', gloss: 80 },
            { id: 'b-rosa', name: 'Rosa', pattern: 'solid', base: '#ec4899', accent: '#ec4899', line: '#000000', gloss: 65 }
        ];
        const PATTERNS_PLAYER = [['solid', 'Liso'], ['stripes', 'Listras'], ['hoops', 'Aros'], ['halves', 'Metades'], ['sash', 'Faixa'], ['checker', 'Xadrez']];
        const PATTERNS_BALL = [['classic', 'Clássica (gomos)'], ['wedges', 'Gomos de praia'], ['seams', 'Basquete (linhas)'], ['gradient', 'Degradê'], ['dots', 'Bolinhas'], ['solid', 'Lisa'], ['stripes', 'Listras'], ['hoops', 'Aros'], ['halves', 'Metades'], ['sash', 'Faixa'], ['checker', 'Xadrez']];
        const uni3d = { yaw: .6, pitch: .3, spinV: .02, auto: true, drag: false, raf: 0, lastX: 0, lastY: 0, lastDx: 0 };
        // Uniformes/bolas criados pelo usuário (cores ou imagem), guardados à parte da personalização.
        const uniformLibrary = (() => {
            try {
                const v = JSON.parse(localStorage.getItem('mb_uniform_library') || '{}');
                return { player: Array.isArray(v.player) ? v.player : [], ball: Array.isArray(v.ball) ? v.ball : [] };
            } catch (error) {
                return { player: [], ball: [] };
            }
        })();
        const uniformImages = new Map();
        function uniformItemSpec(item) {
            if (!item || item.type !== 'image')
                return item || null;
            let entry = uniformImages.get(item.id);
            if (!entry || entry.src !== item.src) {
                const im = new Image();
                im.onload = () => onUniformImageLoaded();
                im.src = item.src;
                entry = { src: item.src, img: im };
                uniformImages.set(item.id, entry);
            }
            return { pattern: 'solid', base: '#000', accent: '#000', img: entry.img, zoom: item.zoom, x: item.x, y: item.y, gloss: item.gloss };
        }
        function readCustomization() {
            try {
                return {
                    ...customizationDefaults,
                    ...JSON.parse(localStorage.getItem('mb_customization') || '{}')
                }
            } catch (error) {
                console.warn('Não foi possível carregar a personalização salva:', error);
                return { ...customizationDefaults }
            }
        }
        const customization = readCustomization();
        const customBallImg = new Image();
        const customPlayerImg = new Image();
        let customBallSoundSource = '';
        let customBallSoundFit = { volume: .35, playbackRate: 1 };
        let ballSoundLoadSequence = 0;
        /* Volume geral (0..1): multiplica todo som do jogo (efeitos, torcida, música, apito). */
        let masterVolume = 1;
        let ballSoundPreset = 'original';
        let ballVolume = 1, goalVolume = 1;   // volumes individuais: bola e gol (0..1)
        try {
            for (const [key, set] of [['fh_ball_volume', v => ballVolume = v], ['fh_goal_volume', v => goalVolume = v]]) {
                const x = parseFloat(localStorage.getItem(key));
                if (isFinite(x))
                    set(Math.max(0, Math.min(1, x)))
            }
            const mv = parseFloat(localStorage.getItem('fh_master_volume'));
            if (isFinite(mv))
                masterVolume = Math.max(0, Math.min(1, mv));
            const bp = localStorage.getItem('fh_ball_preset');
            if (bp)
                ballSoundPreset = bp;
        } catch (e) {}
        try {
            customBallSoundSource = localStorage.getItem('mb_custom_ball_sound') || '';
        } catch (error) {
            console.warn('Não foi possível carregar o áudio personalizado da bola:', error)
        }
        let roomRole = localStorage.getItem('mb_room_role') || 'red';
        let roomOwnerId = null;
        let roomPlayers = [];
        let roomChatMessages = [];
        // Configuracoes da sala editaveis no lobby (limite de tempo/gols e campo).
        const roomConfig = {
            scoreLimit: Math.max(1, Math.min(20, parseInt(localStorage.getItem('mb_room_score'), 10) || 5)),
            timeLimit: Math.max(1, Math.min(30, parseInt(localStorage.getItem('mb_room_time'), 10) || 5))
        };
        function saveRoomConfig() {
            localStorage.setItem('mb_room_score', String(roomConfig.scoreLimit));
            localStorage.setItem('mb_room_time', String(roomConfig.timeLimit));
        }
        function roomTimeSeconds() {
            return roomConfig.timeLimit * 60;
        }
        /* ===== SEÇÃO 2 - SALA DE ESPERA (jogadores, times, arrastar e soltar) ===== */
        function isRoomOwner() {
            return roomOwnerId !== null && roomOwnerId === 'self';
        }
        function updateRoomOwnerControls() {
            const isOwner = isRoomOwner();
            ['pauseGame', 'exit'].forEach(id => {
                const button = $(id);
                if (button)
                    button.hidden = !isOwner;
            });
            const stop = $('stopRoom');
            if (stop) stop.hidden = !isOwner || !(engine && engine.online && engine.running);
            setRoomConfigLocked(!!(engine && engine.online && engine.running) || !isOwner);
        }
        function setRoomConfigLocked(locked) {
            ['roomTimeLimit', 'roomScoreLimit', 'roomFieldVariant'].forEach(id => {
                const el = $(id); if (el) el.disabled = !!locked;
            });
        }
        window.setRoomConfigLocked = setRoomConfigLocked;
        updateRoomOwnerControls();
        function resetRoomPlayers() {
            roomPlayers = [{
                id: 'self',
                nick: state.nick || 'Jogador',
                avatar: state.avatar || 'P1',
                team: roomRole === 'blue' ? 'blue' : roomRole === 'spectator' ? 'spectator' : 'red',
                self: true,
                owner: isRoomOwner()
            }];
            renderRoomPlayers()
        }
        function addRoomPlayer(nick, team='spectator', avatar='P1') {
            const id = 'p_' + Math.random().toString(36).slice(2, 9);
            roomPlayers.push({
                id,
                nick: nick || 'Jogador',
                avatar,
                team,
                self: false
            });
            renderRoomPlayers();
            return id
        }
        /* Arrastar jogador entre os times (toque, caneta e mouse) com pointer events.
           Só o dono da sala move os outros; qualquer um move a si mesmo. */
        function roomDropZoneAt(x, y) {
            const el = document.elementFromPoint(x, y);
            const bz = el && el.closest ? el.closest('.rmBench') : null;
            if (bz) return bz;
            const col = el && el.closest ? el.closest('.rmCol') : null;
            return col ? col.querySelector('.roomDrop') : null;
        }
        function attachRoomCardDrag(card, pl) {
            let drag = null;
            const clearOver = () => document.querySelectorAll('.roomDrop, .rmBench').forEach(x => x.classList.remove('dropOver'));
            const finish = (e, doDrop) => {
                if (!drag)
                    return;
                const d = drag;
                drag = null;
                try { card.releasePointerCapture && card.releasePointerCapture(d.id); } catch (err) {}
                card.classList.remove('dragging');
                clearOver();
                if (d.ghost) d.ghost.remove();
                if (!d.moved || !doDrop)
                    return;
                const z = roomDropZoneAt(e.clientX, e.clientY);
                if (!z)
                    return;
                const team = z.dataset.dropTeam;
                if (team === 'red-bench' || team === 'blue-bench') { if (window.FH_ONLINE) FH_ONLINE.playerAction(team === 'red-bench' ? 'bench1' : 'bench2', pl.cid); return; }
                if (pl.bench && team === 'spectator') { if (window.FH_ONLINE) FH_ONLINE.playerAction('field0', pl.cid); return; }
                if (team === pl.team)
                    return;
                pl.team = team;
                if (pl.self)
                    setRoomRole(team);
                else
                    renderRoomPlayers();
            };
            card.addEventListener('pointerdown', e => {
                if (e.button !== undefined && e.button !== 0)
                    return;
                if (!pl.self && !isRoomOwner())
                    return;
                drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, ghost: null };
                try { card.setPointerCapture && card.setPointerCapture(e.pointerId); } catch (err) {}
            });
            card.addEventListener('pointermove', e => {
                if (!drag || e.pointerId !== drag.id)
                    return;
                if (!drag.moved) {
                    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8)
                        return;
                    drag.moved = true;
                    card.classList.add('dragging');
                    const g = card.cloneNode(true);
                    g.classList.add('rmGhost');
                    g.style.width = card.offsetWidth + 'px';
                    document.body.appendChild(g);
                    drag.ghost = g;
                }
                e.preventDefault();
                drag.ghost.style.transform = 'translate(' + (e.clientX - drag.ghost.offsetWidth / 2) + 'px,' + (e.clientY - drag.ghost.offsetHeight / 2) + 'px)';
                const z = roomDropZoneAt(e.clientX, e.clientY);
                document.querySelectorAll('.roomDrop, .rmBench').forEach(x => x.classList.toggle('dropOver', x === z));
            });
            card.addEventListener('pointerup', e => { if (drag && e.pointerId === drag.id) finish(e, true); });
            card.addEventListener('pointercancel', e => finish(e, false));
            card.addEventListener('contextmenu', e => e.preventDefault());
        }
        /* Menu do jogador (dono da sala): duplo toque/clique ou botão direito -> tornar admin, expulsar, banir */
        function closePlayerMenu() { const m = $('fhPlayerMenu'); if (m) m.remove(); }
        function openPlayerMenu(pl, x, y) {
            closePlayerMenu();
            const menu = document.createElement('div');
            menu.id = 'fhPlayerMenu'; menu.className = 'fhPlayerMenu';
            const iOwner = !!(window.FH_ONLINE && FH_ONLINE.isOwner && FH_ONLINE.isOwner());
            const canHit = !pl.owner && (iOwner || !pl.mod);
            let benchBtns = '';
            if (canHit || iOwner) {
                if (pl.bench) benchBtns = '<button type="button" data-act="field' + pl.bench + '">⚽ Colocar em campo</button>';
                else if (pl.team === 'red' || pl.team === 'blue') benchBtns = '<button type="button" data-act="bench' + (pl.team === 'red' ? 1 : 2) + '">🪑 Mandar pro banco</button>';
                else benchBtns = '<button type="button" data-act="bench1">🪑 Banco do Vermelho</button><button type="button" data-act="bench2">🪑 Banco do Azul</button>';
            }
            menu.innerHTML = '<div class="fpmTitle"></div>' + benchBtns
                + (iOwner ? '<button type="button" data-act="admin">' + (pl.mod ? '🚫 Remover admin' : '👑 Tornar admin') + '</button>' : '')
                + (canHit ? '<button type="button" data-act="kick">🚪 Expulsar da partida</button>'
                + '<button type="button" data-act="ban" class="danger">⛔ Banir da sala</button>' : '');
            if (!menu.querySelector('button')) return;
            menu.querySelector('.fpmTitle').textContent = pl.nick;
            menu.addEventListener('click', e => {
                const b = e.target.closest('button[data-act]'); if (!b) return;
                const act = b.dataset.act;
                closePlayerMenu();
                const run = () => { if (window.FH_ONLINE) FH_ONLINE.playerAction(act, pl.cid); };
                if (act === 'admin') fhConfirm((pl.mod ? 'Remover admin de ' : 'Tornar admin: ') + pl.nick + '?', { ok: 'Confirmar' }).then(y => { if (y) run(); });
                else if (act === 'ban') fhConfirm('Banir ' + pl.nick + ' da sala?', { ok: 'Banir', danger: true }).then(y => { if (y) run(); });
                else run();
            });
            document.body.appendChild(menu);
            const r = menu.getBoundingClientRect();
            menu.style.left = Math.max(6, Math.min(x, innerWidth - r.width - 6)) + 'px';
            menu.style.top = Math.max(6, Math.min(y, innerHeight - r.height - 6)) + 'px';
            setTimeout(() => {
                const off = ev => { if (!menu.contains(ev.target)) { closePlayerMenu(); document.removeEventListener('pointerdown', off, true); } };
                document.addEventListener('pointerdown', off, true);
            }, 0);
        }
        function attachPlayerMenu(card, pl) {
            if (pl.self || pl.cid == null) return;
            const canOpen = () => isRoomOwner() && window.FH_ONLINE && FH_ONLINE.active() && !(window.FH_RANKED && FH_RANKED.active());
            let lastTap = 0;
            card.addEventListener('click', e => {
                const now = Date.now();
                if (now - lastTap < 400 && canOpen()) { lastTap = 0; openPlayerMenu(pl, e.clientX, e.clientY); }
                else lastTap = now;
            });
            card.addEventListener('contextmenu', e => { e.preventDefault(); if (canOpen()) openPlayerMenu(pl, e.clientX, e.clientY); });
        }
        function renderRoomPlayers() {
            const lists = {
                red: $('redList'),
                blue: $('blueList'),
                spectator: $('spectatorList'),
                redBench: $('redBench'),
                blueBench: $('blueBench')
            };
            Object.values(lists).forEach(el => {
                if (el)
                    el.innerHTML = ''
            }
            );
            if (!roomPlayers.length)
                resetRoomPlayers();
            for (const pl of roomPlayers) {
                const box = (pl.bench === 1 ? lists.redBench : pl.bench === 2 ? lists.blueBench : null) || lists[pl.team] || lists.spectator;
                if (!box)
                    continue;
                const card = document.createElement('div');
                card.className = 'rmCard ' + (pl.bench ? (pl.bench === 1 ? 'red' : 'blue') + ' benched' : pl.team === 'spectator' ? 'spectator' : pl.team);
                if (pl.self)
                    card.classList.add('self');
                card.draggable = false;
                card.dataset.playerId = pl.id;
                const avTxt = String(pl.avatar || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || String(pl.nick || '?').slice(0, 1).toUpperCase();
                card.innerHTML = '<span class="rpAv">' + escapeHtml(avTxt) + '</span><span class="rpNick">' + escapeHtml(pl.nick) + '</span><span class="miniRole">' + (pl.owner ? 'DONO' : pl.self ? 'VOCÊ' : '') + '</span>'
                    + '<span class="rpPing" data-ping-id="' + escapeHtml(String(pl.cid != null ? pl.cid : '')) + '">' + (window.FH_ROOMUI && pl.cid != null ? FH_ROOMUI.pingHtml(pl.ping) : '') + '</span>';
                card.addEventListener('dragstart', e => e.preventDefault());
                attachRoomCardDrag(card, pl);
                attachPlayerMenu(card, pl);
                box.appendChild(card)
            }
        }
        function renderChatMessages(containerId) {
            const messages = $(containerId);
            if (!messages)
                return;
            messages.replaceChildren();
            for (const entry of roomChatMessages) {
                const message = document.createElement('div');
                message.className = containerId === 'gameChatMessages' ? 'gameChatMessage' : 'roomChatMessage';
                const author = document.createElement('strong');
                author.textContent = entry.author;
                if (entry.team)
                    author.classList.add(entry.team);
                const text = document.createElement('span');
                text.textContent = entry.text;
                message.append(author, text);
                messages.appendChild(message)
            }
            messages.scrollTop = messages.scrollHeight
        }
        function renderRoomChat() {
            renderChatMessages('roomChatMessages');
            renderChatMessages('gameChatMessages')
        }
        function sendRoomChatMessage(event) {
            event.preventDefault();
            const input = event.currentTarget.querySelector('input');
            const text = input.value.trim();
            if (!text)
                return;
            if (window.FH_ONLINE && FH_ONLINE.active()) {      // sala online: o servidor distribui (e limita) o chat
                FH_ONLINE.chat(text);
                input.value = '';
                if (input.id === 'gameChatInput')
                    input.focus();
                return
            }
            roomChatMessages.push({
                author: state.nick || 'Jogador',
                team: roomRole === 'blue' ? 'blue' : 'red',
                text: text.slice(0, 240)
            });
            if (roomChatMessages.length > 60)
                roomChatMessages.shift();
            input.value = '';
            renderRoomChat();
            if (input.id === 'gameChatInput')
                input.focus()
        }
        function escapeHtml(v) {
            return String(v).replace(/[&<>"']/g, m => ({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '\"': '&quot;',
                "'": '&#39;'
            }[m]))
        }
        function setRoomRole(role) {
            roomRole = role;
            localStorage.setItem('mb_room_role', role);
            const me = roomPlayers.find(p => p.self);
            if (me)
                me.team = role;
            if (engine && engine.players[0])
                engine.players[0].team = role === 'blue' ? 'blue' : 'red';
            renderRoomPlayers()
        }
        function setupRoomDrag() {
            document.querySelectorAll('.roomDrop, .rmBench').forEach(zone => {
                zone.addEventListener('dragover', e => {
                    e.preventDefault();
                    zone.classList.add('dropOver')
                }
                );
                zone.addEventListener('dragleave', () => zone.classList.remove('dropOver'));
                zone.addEventListener('drop', e => {
                    e.preventDefault();
                    zone.classList.remove('dropOver');
                    const id = e.dataTransfer.getData('text/plain');
                    const pl = roomPlayers.find(p => p.id === id);
                    if (!pl)
                        return;
                    const team = zone.dataset.dropTeam;
                    pl.team = team;
                    if (pl.self)
                        setRoomRole(team);
                    else
                        renderRoomPlayers()
                }
                )
            }
            )
        }

        $('nick').value = state.nick;
        $('avatar').value = state.avatar;
        $('avatar').addEventListener('input', () => {
            $('avatar').value = Array.from($('avatar').value).slice(0, 2).join('')
        }
        );
        resetRoomPlayers();
        setupRoomDrag();
        // --- Organizar times (Auto / Sortear / Zerar) e configuracoes da sala ---
        function commitTeamChanges() {
            const me = roomPlayers.find(p => p.self);
            if (me) {
                roomRole = me.team;
                localStorage.setItem('mb_room_role', me.team);
                if (engine && engine.players[0])
                    engine.players[0].team = me.team === 'blue' ? 'blue' : 'red';
            }
            renderRoomPlayers();
        }
        function autoBalanceTeams() {
            let red = 0, blue = 0;
            for (const pl of roomPlayers) {
                if (red <= blue) { pl.team = 'red'; red++; }
                else { pl.team = 'blue'; blue++; }
            }
            commitTeamChanges();
        }
        function shuffleTeams() {
            const arr = roomPlayers.slice();
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            arr.forEach((pl, i) => { pl.team = i % 2 === 0 ? 'red' : 'blue'; });
            commitTeamChanges();
        }
        function clearTeams() {
            roomPlayers.forEach(pl => { pl.team = 'spectator'; });
            commitTeamChanges();
        }
        // --- Botoes de time (Vermelho / Espectadores / Azul) e setas ---
        const ROOM_TEAM_ORDER = ['red', 'spectator', 'blue'];
        function moveSelfToTeam(team) {
            const me = roomPlayers.find(p => p.self);
            if (!me || me.team === team) return;
            me.team = team;
            setRoomRole(team);
        }
        document.querySelectorAll('[data-join-team]').forEach(btn => {
            btn.addEventListener('click', () => moveSelfToTeam(btn.dataset.joinTeam));
        });
        document.querySelectorAll('[data-shift-team]').forEach(btn => {
            btn.addEventListener('click', () => {
                const me = roomPlayers.find(p => p.self);
                if (!me) return;
                const i = ROOM_TEAM_ORDER.indexOf(me.team);
                const n = Math.max(0, Math.min(ROOM_TEAM_ORDER.length - 1, i + parseInt(btn.dataset.shiftTeam, 10)));
                moveSelfToTeam(ROOM_TEAM_ORDER[n]);
            });
        });
        if ($('roomAuto')) $('roomAuto').onclick = autoBalanceTeams;
        if ($('roomShuffle')) $('roomShuffle').onclick = shuffleTeams;
        if ($('roomClear')) $('roomClear').onclick = clearTeams;
        function syncRoomConfigInputs() {
            if ($('roomTimeLimit')) $('roomTimeLimit').value = roomConfig.timeLimit;
            if ($('roomScoreLimit')) $('roomScoreLimit').value = roomConfig.scoreLimit;
            if ($('roomFieldVariant')) $('roomFieldVariant').value = fieldVariant || 'v3';
        }
        if ($('roomTimeLimit')) $('roomTimeLimit').addEventListener('change', () => {
            let v = parseInt($('roomTimeLimit').value, 10);
            if (!Number.isFinite(v)) v = 5;
            roomConfig.timeLimit = Math.max(1, Math.min(30, v));
            $('roomTimeLimit').value = roomConfig.timeLimit;
            saveRoomConfig();
            if (window.FH_ONLINE) window.FH_ONLINE.requestConfig({ time: roomConfig.timeLimit, score: roomConfig.scoreLimit, map: fieldVariant });
        });
        if ($('roomScoreLimit')) $('roomScoreLimit').addEventListener('change', () => {
            let v = parseInt($('roomScoreLimit').value, 10);
            if (!Number.isFinite(v)) v = 5;
            roomConfig.scoreLimit = Math.max(1, Math.min(20, v));
            $('roomScoreLimit').value = roomConfig.scoreLimit;
            saveRoomConfig();
            if (window.FH_ONLINE) window.FH_ONLINE.requestConfig({ time: roomConfig.timeLimit, score: roomConfig.scoreLimit, map: fieldVariant });
        });
        if ($('roomFieldVariant')) $('roomFieldVariant').addEventListener('change', () => {
            fieldVariant = $('roomFieldVariant').value || 'v3';
            mapKey = fieldVariant || 'v3';
            if ($('roomTitle')) {
                const base = ($('roomName') && $('roomName').value) || (state.nick + ' — Sala');
                $('roomTitle').textContent = base + ' • ' + mapLabel(fieldVariant);
            }
            if (window.FH_ONLINE) window.FH_ONLINE.requestConfig({ time: roomConfig.timeLimit, score: roomConfig.scoreLimit, map: fieldVariant });
        });
        syncRoomConfigInputs();
        /* ===== SEÇÃO 3 - NAVEGAÇÃO ENTRE TELAS E CONFIGURAÇÕES ===== */
        function img(k) {
            return A[k] || ''
        }
        function show(id) {
            document.querySelectorAll('.screen').forEach(x => x.classList.remove('on'));
            $(id).classList.add('on');
            if (id === 'lobbyScreen' || id === 'homeScreen')
                startGameMusic();
            if (id === 'homeScreen')
                openHome();
            else if (id === 'game') {
                applyGameChatSettings();
                pauseGameMusic()
            }
        }
        function saveSettings() {
            localStorage.setItem('mb_settings', JSON.stringify(state.settings))
        }
        function loadSettings() {
            for (const [id,key] of [['setSound', 'sound'], ['setPlayer', 'player'], ['setGamepad', 'gamepad'], ['setKick', 'kick'], ['setSize', 'size'], ['setPos', 'pos'], ['setKeyboard', 'keyboard'], ['setShout', 'shout']])
                $(id).value = state.settings[key]
            $('setHideMobileControls').checked = state.settings.hideMobileControls === true
        }
        function applyHUD() {
            const st = state.settings;
            const sizes = {
                small: 105,
                medium: 142,
                big: 175,
                huge: 210
            };
            $('joy').style.width = sizes[st.size] + 'px';
            $('joy').style.height = sizes[st.size] + 'px';
            $('joy').style.left = st.pos === 'left' ? '20px' : 'auto';
            $('joy').style.right = st.pos === 'right' ? '20px' : 'auto';
            $('kick').classList.toggle('half', st.kick === 'half');
            $('shout').style.display = st.shout === 'on' ? 'flex' : 'none';
            $('game').classList.toggle('hideMobileControls', st.hideMobileControls === true)
        }
        loadSettings();
        applyHUD();
        /* ===== SEÇÃO 4 - HUD DENTRO DO JOGO (analógico, botões, zoom, câmera) ===== */
        let gameZoom = 1
          , cameraOffset = 0
          , cameraStyle = 1; // 0 = clássica (meio entre jogador e bola), 1 = foco no jogador
        const gameHudPadrãos = {
            joySize: 142,
            stickSize: 1,
            kickSize: 1,
            hudOpacity: 1,
            joyX: 10,
            joyY: 70,
            kickX: 80,
            kickY: 78,
            passX: 75,
            passY: 40,
            gameZoom: 1,
            cameraOffset: 0,
            cameraStyle: 1
        };
        function readGameHud() {
            const raw = JSON.parse(localStorage.getItem('mb_game_hud') || 'null') || {};
            if (raw.passX === 93 && raw.passY === 78) {
                raw.passX = 75;
                raw.passY = 40
            }
            for (const k in gameHudPadrãos) {
                const el = $(k);
                if (el)
                    el.value = raw[k] ?? gameHudPadrãos[k]
            }
            gameZoom = +(raw.gameZoom ?? 1);
            cameraOffset = +(raw.cameraOffset ?? 0);
            cameraStyle = +(raw.cameraStyle ?? 1)
        }
        function saveGameHud() {
            const out = {};
            for (const k in gameHudPadrãos) {
                const el = $(k);
                if (el)
                    out[k] = +el.value
            }
            localStorage.setItem('mb_game_hud', JSON.stringify(out))
        }
        function saveHudNow() {
            saveGameHud();
            const b = $('saveHudBtn');
            if (b) {
                const t = b.textContent;
                b.textContent = '✓ HUD salvo';
                setTimeout( () => b.textContent = t, 900)
            }
        }
        function applyGameHUD() {
            const joySize = +$('joySize').value
              , stickScale = +$('stickSize').value
              , kickScale = +$('kickSize').value
              , jx = +$('joyX').value
              , jy = +$('joyY').value
              , kx = +$('kickX').value
              , ky = +$('kickY').value
              , px = +$('passX').value
              , py = +$('passY').value;
            const j = $('joy')
              , kn = j.querySelector('.knob')
              , kick = $('kick')
              , pass = $('pass');
            j.style.width = joySize + 'px';
            j.style.height = joySize + 'px';
            j.style.left = jx + '%';
            j.style.top = jy + '%';
            j.style.right = 'auto';
            j.style.bottom = 'auto';
            j.style.transform = 'translate(-50%,-50%)';
            kn.style.transform = 'translate(-50%,-50%) scale(' + stickScale + ')';
            kick.style.left = kx + '%';
            kick.style.top = ky + '%';
            kick.style.right = 'auto';
            kick.style.bottom = 'auto';
            kick.style.transform = 'translate(-50%,-50%) scale(' + kickScale + ')';
            pass.style.left = px + '%';
            pass.style.top = py + '%';
            pass.style.right = 'auto';
            pass.style.bottom = 'auto';
            pass.style.transform = 'translate(-50%,-50%) scale(' + kickScale + ')';
            $('game').style.setProperty('--hud-opacity', +$('hudOpacity').value);
            $('gameSettings').style.opacity = +$('hudOpacity').value;
            gameZoom = +$('gameZoom').value;
            cameraOffset = +$('cameraOffset').value;
            cameraStyle = +$('cameraStyle').value;
            saveGameHud()
        }
        $('saveHudBtn')?.addEventListener('click', saveHudNow);
        let hudMoveMode = null;
        function stopHudMove() {
            hudMoveMode = null;
            $('moveJoyBtn').classList.remove('active');
            $('moveKickBtn').classList.remove('active');
            $('movePassBtn').classList.remove('active');
            $('moveHint').classList.add('hidden')
        }
        function startHudMove(which) {
            hudMoveMode = which;
            $('moveJoyBtn').classList.toggle('active', which === 'joy');
            $('moveKickBtn').classList.toggle('active', which === 'kick');
            $('movePassBtn').classList.toggle('active', which === 'pass');
            $('moveHint').classList.remove('hidden');
            $('gameSettings').classList.add('hidden')
        }
        function moveHudTo(e, which) {
            const el = which === 'joy' ? $('joy') : which === 'kick' ? $('kick') : $('pass');
            const r = $('game').getBoundingClientRect();
            const halfX = Math.max(28, el.getBoundingClientRect().width / 2) / r.width * 100;
            const halfY = Math.max(28, el.getBoundingClientRect().height / 2) / r.height * 100;
            const x = Math.max(halfX, Math.min(100 - halfX, (e.clientX - r.left) / r.width * 100));
            const y = Math.max(halfY, Math.min(100 - halfY, (e.clientY - r.top) / r.height * 100));
            const xKey = which === 'joy' ? 'joyX' : which === 'kick' ? 'kickX' : 'passX';
            const yKey = which === 'joy' ? 'joyY' : which === 'kick' ? 'kickY' : 'passY';
            $(xKey).value = Math.round(x);
            $(yKey).value = Math.round(y);
            applyGameHUD()
        }
        const crowdOn = localStorage.getItem('mb_crowd_enabled') !== 'off';
        $('crowdEnabled').checked = crowdOn;
        $('crowdVolume').value = localStorage.getItem('mb_crowd_volume') ?? '0.12';
        $('crowdEnabled').addEventListener('change', () => {
            configureCrowd();
            if ($('crowdEnabled').checked && engine && !engine.paused)
                startCrowdAudio();
            else
                pauseCrowdAudio()
        }
        );
        $('crowdVolume').addEventListener('input', configureCrowd);
        /* Volume geral + presets de som da bola */
        const syncMasterUi = () => {
            const pct = Math.round(masterVolume * 100);
            $('pageMasterVolume').value = pct;
            $('pageMasterVolumeVal').textContent = pct + '%';
            $('gameMasterVolume').value = pct;
            $('gameMasterVolumeVal').textContent = pct + '%'
        };
        syncMasterUi();
        const extraVol = [['Ball', 'fh_ball_volume', () => ballVolume, v => ballVolume = v], ['Goal', 'fh_goal_volume', () => goalVolume, v => goalVolume = v]];
        const syncExtraUi = () => {
            for (const [n,,get] of extraVol)
                for (const pre of ['page', 'game']) {
                    $(pre + n + 'Volume').value = Math.round(get() * 100);
                    $(pre + n + 'VolumeVal').textContent = Math.round(get() * 100) + '%'
                }
        };
        syncExtraUi();
        for (const [n,key,get,set] of extraVol)
            for (const pre of ['page', 'game']) {
                const id = pre + n + 'Volume';
                $(id).addEventListener('input', () => {
                    set(Math.max(0, Math.min(1, +$(id).value / 100)));
                    try { localStorage.setItem(key, String(get())); } catch (e) {}
                    syncExtraUi()
                });
                $(id).addEventListener('change', () => {
                    if (n === 'Goal')
                        play('sound/whistle_01.mp3', true);
                    else
                        play('sound/kick_ball.mp3', true)
                })
            }
        for (const id of ['pageMasterVolume', 'gameMasterVolume']) {
            $(id).addEventListener('input', () => {
                applyMasterVolume(+$(id).value / 100);
                syncMasterUi()
            });
            $(id).addEventListener('change', () => play('sound/kick_ball.mp3', true))
        }
        $('ballSoundPreset').value = customBallSoundSource ? 'custom' : (document.querySelector('#ballSoundPreset option[value="' + ballSoundPreset + '"]') ? ballSoundPreset : 'original');
        $('ballSoundPreset').addEventListener('change', () => {
            const v = $('ballSoundPreset').value;
            if (v === 'custom')
                return;
            ballSoundLoadSequence++;
            ballSoundPreset = v;
            try {
                localStorage.setItem('fh_ball_preset', v);
                localStorage.removeItem('mb_custom_ball_sound')
            } catch (e) {}
            customBallSoundSource = '';
            customBallSoundFit = { volume: .35, playbackRate: 1 };
            $('ballSoundStatus').textContent = v === 'original' ? 'Usando o som original da bola.' : 'Preset de som da bola aplicado.';
            play('sound/kick_ball.mp3', true)
        });
        const markCustomBallSound = () => {
            const opt = document.querySelector('#ballSoundPreset option[value="custom"]');
            opt.disabled = false;
            $('ballSoundPreset').value = 'custom'
        };
        $('chooseBallSound').addEventListener('click', () => $('customBallSoundFile').click());
        $('customBallSoundFile').addEventListener('change', async event => {
            const loadSequence = ++ballSoundLoadSequence;
            const input = event.currentTarget;
            const file = input.files && input.files[0];
            if (!file)
                return;
            if (!file.type.startsWith('audio/')) {
                $('ballSoundStatus').textContent = 'Escolha um arquivo de áudio compatível.';
                input.value = '';
                return
            }
            if (file.size > 512 * 1024) {
                $('ballSoundStatus').textContent = 'O áudio deve ter no máximo 512 KB.';
                input.value = '';
                return
            }
            $('ballSoundStatus').textContent = 'Analisando volume e duração do áudio...';
            const reader = new FileReader();
            reader.onerror = () => {
                $('ballSoundStatus').textContent = 'Não foi possível ler o áudio selecionado.';
                input.value = ''
            };
            reader.onload = async () => {
                try {
                    const fit = await calculateBallSoundFit(String(reader.result));
                    if (loadSequence !== ballSoundLoadSequence)
                        return;
                    localStorage.setItem('mb_custom_ball_sound', String(reader.result));
                    customBallSoundSource = String(reader.result);
                    customBallSoundFit = fit;
                    markCustomBallSound();
                    $('ballSoundStatus').textContent = `Áudio ajustado ao original: volume ${Math.round(fit.volume * 100)}%, velocidade ${fit.playbackRate.toFixed(2)}x.`;
                } catch (error) {
                    if (loadSequence !== ballSoundLoadSequence)
                        return;
                    console.error('Não foi possível ajustar o áudio da bola:', error);
                    $('ballSoundStatus').textContent = error.message || 'Não foi possível analisar o áudio. Tente outro arquivo.';
                }
                input.value = ''
            };
            reader.readAsDataURL(file)
        });
        $('testBallSound').addEventListener('click', () => {
            play('sound/kick_ball.mp3', true)
        });
        $('removeBallSound').addEventListener('click', () => {
            ballSoundLoadSequence++;
            try {
                localStorage.removeItem('mb_custom_ball_sound');
                customBallSoundSource = '';
                customBallSoundFit = { volume: .35, playbackRate: 1 };
                ballSoundPreset = 'original';
                localStorage.setItem('fh_ball_preset', 'original');
                $('ballSoundPreset').value = 'original';
                $('ballSoundStatus').textContent = 'Usando o som original da bola.';
            } catch (error) {
                console.error('Não foi possível remover o áudio personalizado:', error);
                $('ballSoundStatus').textContent = 'Não foi possível remover o áudio salvo.'
            }
        });
        if (customBallSoundSource) {
            document.querySelector('#ballSoundPreset option[value="custom"]').disabled = false;
            $('ballSoundPreset').value = 'custom';
            const loadSequence = ballSoundLoadSequence;
            $('ballSoundStatus').textContent = 'Analisando o áudio salvo...';
            calculateBallSoundFit(customBallSoundSource).then(fit => {
                if (loadSequence !== ballSoundLoadSequence)
                    return;
                customBallSoundFit = fit;
                $('ballSoundStatus').textContent = `Áudio ajustado ao original: volume ${Math.round(fit.volume * 100)}%, velocidade ${fit.playbackRate.toFixed(2)}x.`;
            }).catch(error => {
                if (loadSequence !== ballSoundLoadSequence)
                    return;
                console.error('Não foi possível analisar o áudio salvo da bola:', error);
                $('ballSoundStatus').textContent = 'O áudio salvo não pôde ser analisado. Escolha outro arquivo ou use o som original.'
            })
        }
        readGameHud();
        $('gameSettingsBtn').onclick = () => {
            $('gameSettings').classList.toggle('hidden');
            stopHudMove()
        }
        ;
        $('closeGameSettings').onclick = () => {
            $('gameSettings').classList.add('hidden');
            stopHudMove()
        }
        ;
        $('moveJoyBtn').onclick = () => startHudMove('joy');
        $('moveKickBtn').onclick = () => startHudMove('kick');
        $('movePassBtn').onclick = () => startHudMove('pass');
        ['joySize', 'stickSize', 'kickSize', 'hudOpacity', 'gameZoom', 'cameraOffset', 'cameraStyle'].forEach(id => $(id).oninput = applyGameHUD);
        applyGameHUD();
        readGameHud();
        $('gameSettingsBtn').onclick = () => $('gameSettings').classList.toggle('hidden');
        $('closeGameSettings').onclick = () => $('gameSettings').classList.add('hidden');
        ['joySize', 'stickSize', 'kickSize', 'hudOpacity', 'gameZoom', 'cameraOffset', 'cameraStyle'].forEach(id => $(id).oninput = applyGameHUD);
        applyGameHUD();
        const settingsHudPairs = [
            ['pageJoySize', 'joySize'],
            ['pageStickSize', 'stickSize'],
            ['pageKickSize', 'kickSize'],
            ['pageGameZoom', 'gameZoom'],
            ['pageCameraOffset', 'cameraOffset'],
            ['pageCameraStyle', 'cameraStyle'],
            ['pageHudOpacity', 'hudOpacity']
        ];
        function syncSettingsHud() {
            settingsHudPairs.forEach(([pageId, gameId]) => {
                $(pageId).value = $(gameId).value
            });
            $('pageCrowdEnabled').checked = $('crowdEnabled').checked;
            $('pageCrowdVolume').value = $('crowdVolume').value;
            syncGameChatSettings();
            syncGraphicsControls()
        }
        $('graphicsPreset').addEventListener('change', () => applyGraphicsPreset($('graphicsPreset').value));
        ['renderScale', 'fpsLimit', 'showBallGuide', 'showGoalSprites', 'showPlayerShadows', 'ballStyle3d'].forEach(id => {
            $(id).addEventListener(id === 'renderScale' ? 'input' : 'change', updateGraphicsSettingsFromControls)
        });
        syncGraphicsControls();
        function updateGameChatSettingsFromControls() {
            gameChatSettings.enabled = $('pageChatEnabled').checked;
            gameChatSettings.width = +$('pageChatWidth').value;
            gameChatSettings.opacity = +$('pageChatOpacity').value;
            gameChatSettings.x = +$('pageChatX').value;
            gameChatSettings.y = +$('pageChatY').value;
            saveGameChatSettings();
            applyGameChatSettings()
        }
        ['pageChatEnabled', 'pageChatWidth', 'pageChatOpacity', 'pageChatX', 'pageChatY'].forEach(id => {
            $(id).addEventListener(id === 'pageChatEnabled' ? 'change' : 'input', updateGameChatSettingsFromControls)
        });
        syncGameChatSettings();
        window.addEventListener('resize', applyGameChatSettings);
        function keyBindingLabel(key) {
            if (key === ' ')
                return 'Espaço';
            if (key.startsWith('arrow'))
                return ({ arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' })[key] || key;
            return key.length === 1 ? key.toUpperCase() : key
        }
        function renderKeyBindings() {
            document.querySelectorAll('[data-key-binding]').forEach(button => {
                const action = button.dataset.keyBinding;
                button.textContent = keyBindingLabel(keyBindings[action]);
                button.classList.toggle('listening', activeKeyBinding === action)
            })
        }
        function normalizeKey(event) {
            return event.code === 'Space' ? ' ' : event.key.toLowerCase()
        }
        function captureKeyBinding(event) {
            if (!activeKeyBinding)
                return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            if (event.key === 'Escape') {
                activeKeyBinding = null;
                renderKeyBindings();
                return
            }
            if (event.key.length !== 1 && !event.key.startsWith('Arrow') && event.code !== 'Space')
                return;
            const key = normalizeKey(event);
            const conflict = Object.entries(keyBindings).find(([action, boundKey]) => boundKey === key && action !== activeKeyBinding);
            if (conflict) {
                const labels = { up: 'Mover para cima', down: 'Mover para baixo', left: 'Mover para esquerda', right: 'Mover para direita', kick: 'Chutar', pass: 'Passar' };
                fhAlert(`Essa tecla já está sendo usada em “${labels[conflict[0]]}”.`);
                return
            }
            keyBindings[activeKeyBinding] = key;
            activeKeyBinding = null;
            try {
                localStorage.setItem('mb_key_bindings', JSON.stringify(keyBindings))
            } catch (error) {
                console.error('Não foi possível salvar as teclas:', error);
                fhAlert('Não foi possível salvar a tecla neste dispositivo.')
            }
            renderKeyBindings()
        }
        document.addEventListener('keydown', captureKeyBinding, true);
        document.querySelectorAll('[data-key-binding]').forEach(button => {
            button.addEventListener('click', () => {
                activeKeyBinding = button.dataset.keyBinding;
                renderKeyBindings()
            })
        });
        renderKeyBindings();
        settingsHudPairs.forEach(([pageId, gameId]) => {
            $(pageId).addEventListener('input', () => {
                $(gameId).value = $(pageId).value;
                applyGameHUD()
            })
        });
        $('pageCrowdEnabled').addEventListener('change', () => {
            $('crowdEnabled').checked = $('pageCrowdEnabled').checked;
            $('crowdEnabled').dispatchEvent(new Event('change'))
        });
        $('pageCrowdVolume').addEventListener('input', () => {
            $('crowdVolume').value = $('pageCrowdVolume').value;
            $('crowdVolume').dispatchEvent(new Event('input'))
        });
        document.querySelectorAll('[data-settings-tab]').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('[data-settings-tab]').forEach(item => {
                    const active = item === tab;
                    item.classList.toggle('active', active);
                    item.setAttribute('aria-selected', String(active))
                });
                document.querySelectorAll('.settingsTabPanel').forEach(panel => {
                    const active = panel.id === tab.dataset.settingsTab;
                    panel.classList.toggle('active', active);
                    panel.hidden = !active
                })
            })
        });
        function openSettings(returnScreen, tabId='settingsControls') {
            settingsReturnScreen = returnScreen;
            loadSettings();
            syncSettingsHud();
            loadCustomizationControls();
            const tab = document.querySelector(`[data-settings-tab="${tabId}"]`);
            if (tab)
                tab.click();
            show('settingsScreen')
        }
        syncSettingsHud();
        loadCustomizationControls();
        const customizationInputs = [
            'customDark', 'customThemeColor', 'customLineColor',
            'customBallZoom', 'customBallX', 'customBallY', 'customPlayerZoom',
            'customPlayerX', 'customPlayerY'
        ];
        customizationInputs.forEach(id => $(id).addEventListener('input', updateCustomizationFromControls));
        $('customBallColor').addEventListener('input', () => {
            customization.ballImage = '';
            $('customBallImage').value = '';
            updateCustomizationFromControls()
        });
        $('chooseBallImage').onclick = () => $('customBallImage').click();
        $('choosePlayerImage').onclick = () => $('customPlayerImage').click();
        $('removeBallImage').onclick = () => clearCustomizationImage('ballImage');
        $('removePlayerImage').onclick = () => clearCustomizationImage('playerImage');
        loadCustomizationImage('customBallImage', 'ballImage');
        loadCustomizationImage('customPlayerImage', 'playerImage');
        $('customBallImage').value = '';
        $('customPlayerImage').value = '';
        $('settingsBack').addEventListener('click', saveCustomization);

        /* ===== TELA DE UNIFORMES (v2): prévia do item, abas Jogador/Bola, biblioteca e editor (+) ===== */
        let uniformTarget = 'player';
        let editorDraft = null;
        function onUniformImageLoaded() {
            if ($('uniformScreen').classList.contains('on')) {
                buildUniformList();
                renderUniformScreen();
            }
            drawCustomizationPreviewBall();
            if (engine)
                draw();
        }
        function uniformItems(kind) {
            return kind === 'ball'
                ? [{ id: 'normal', name: 'Normal' }, ...BALL_PRESETS, ...uniformLibrary.ball]
                : [{ id: 'normal', name: 'Normal' }, ...UNIFORMS, ...FH_EXCL.ownedKits(), ...uniformLibrary.player];
        }
        function currentUniformItem(kind) {
            const id = customization[kind + 'Uniform'] || 'normal';
            return uniformItems(kind).find(i => i.id === id) || { id: 'normal', name: 'Normal' };
        }
        // Converte um uniforme (ou null = "Normal") no formato que o Ball3D entende.
        function ballSpec3D(u) {
            if (!u) {
                if (customization.ballImage && customBallImg.complete && customBallImg.naturalWidth)
                    return { pattern: 'solid', base: '#ffffff', img: customBallImg, zoom: customization.ballZoom, x: customization.ballX, y: customization.ballY, gloss: 55 };
                return { pattern: 'solid', base: customization.ballColor, accent: customization.ballColor, gloss: 55 };
            }
            return { pattern: u.pattern || 'solid', base: u.base, accent: u.accent, line: u.line || '#1d2025', gloss: u.gloss == null ? 60 : u.gloss, img: u.img, zoom: u.zoom, x: u.x, y: u.y };
        }
        function drawUniformSample(canvas, kind, uniform) {
            if (kind === 'ball') {
                Ball3D.drawStatic(canvas, ballSpec3D(uniform), { yaw: .55, pitch: .32 });
                return;
            }
            const ctx = canvas.getContext('2d');
            const size = canvas.width;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, size, size);
            const R = size * .42;
            ctx.setTransform(R, 0, 0, R, size / 2, size / 2);
            drawPlayer(ctx, { x: 0, y: 0, r: 1, team: roomRole === 'blue' ? 'blue' : 'red' }, state.avatar, 0, false, uniform);
            ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        function selectUniform(id) {
            const t = uniformTarget;
            customization[t + 'Uniform'] = id;
            customization[t + 'Image'] = ''; // a imagem antiga das Configurações cobriria o uniforme escolhido
            saveCustomization();
            applyCustomization();
            if (t === 'ball')
                uni3d.spinV = .24; // giro rápido ao escolher
            else
                FH_EXCL.equip('kit', String(id).startsWith('x-') ? id : null);   // o servidor guarda para os outros jogadores verem
        }
        // Ao entrar/sair da conta: o uniforme exclusivo equipado no servidor vale em qualquer aparelho.
        FH_EXCL.onChange = () => {
            const k = FH_EXCL.equipped('kit'), cur = customization.playerUniform || 'normal';
            if (k && cur !== k) {
                customization.playerUniform = k;
                saveCustomization();
                applyCustomization();
            } else if (!k && String(cur).startsWith('x-')) {
                customization.playerUniform = 'normal';
                saveCustomization();
                applyCustomization();
            }
            if ($('uniformScreen').classList.contains('on')) {
                buildUniformList();
                renderUniformScreen();
            }
        };
        function saveUniformLibrary() {
            try {
                localStorage.setItem('mb_uniform_library', JSON.stringify(uniformLibrary));
                return true;
            } catch (error) {
                fhAlert('Não foi possível salvar. Use uma imagem menor e tente novamente.');
                return false;
            }
        }
        function buildUniformList() {
            const list = $('uniformList');
            const kind = uniformTarget;
            if (kind === 'fx') {
                buildFxList(list);
                return;
            }
            const keepScroll = list.scrollLeft;
            list.textContent = '';
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const current = customization[kind + 'Uniform'] || 'normal';
            uniformItems(kind).forEach(item => {
                const custom = uniformLibrary[kind].includes(item);
                const wrap = document.createElement('div');
                wrap.className = 'uniformCardWrap';
                const card = document.createElement('button');
                card.type = 'button';
                card.className = 'uniformCard' + (item.id === current ? ' active' : '');
                card.dataset.uniform = item.id;
                if (item.exclusive) {
                    card.classList.add('exclusive');
                    card.dataset.rarity = item.rarity || 'legendary';
                }
                const cv = document.createElement('canvas');
                cv.width = cv.height = Math.round(96 * dpr);
                const name = document.createElement('span');
                name.textContent = item.name;
                card.append(cv, name);
                card.addEventListener('click', () => selectUniform(item.id));
                wrap.append(card);
                if (custom) {
                    const del = document.createElement('button');
                    del.type = 'button';
                    del.className = 'uniformDel';
                    del.setAttribute('aria-label', 'Excluir ' + item.name);
                    del.textContent = '×';
                    del.addEventListener('click', () => {
                        fhConfirm('Excluir "' + item.name + '"?', { ok: 'Excluir', danger: true }).then(yes => {
                        if (!yes) return;
                        uniformLibrary[kind].splice(uniformLibrary[kind].indexOf(item), 1);
                        saveUniformLibrary();
                        if (customization[kind + 'Uniform'] === item.id)
                            selectUniform('normal');
                        else
                            buildUniformList();
                        renderUniformScreen();
                        });
                    });
                    wrap.append(del);
                }
                list.append(wrap);
                drawUniformSample(cv, kind, item.id === 'normal' ? null : uniformItemSpec(item));
            });
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'uniformCard uniformAdd';
            add.setAttribute('aria-label', kind === 'ball' ? 'Adicionar bola' : 'Adicionar uniforme');
            add.innerHTML = '<b>+</b><span>' + (kind === 'ball' ? 'Nova bola' : 'Novo uniforme') + '</span>';
            add.addEventListener('click', () => openUniformEditor(null));
            list.append(add);
            list.scrollLeft = keepScroll;
        }
        /* ----- aba "Efeito de gol" ----- */
        let fxView = null;      // efeito mostrado no palco (pode ser um ainda bloqueado, só para ver)
        function fxViewId() {
            if (fxView && FH_GOALFX.has(fxView) && FH_EXCL.owns(fxView))
                return fxView;
            const own = FH_EXCL.ownedFx();
            return FH_EXCL.equipped('fx') || (own[0] && own[0].id) || null;
        }
        function buildFxList(list) {
            const keepTop = list.scrollTop;
            list.textContent = '';
            const cur = FH_EXCL.equipped('fx') || null;
            const owned = FH_EXCL.ownedFx(), ownedIds = new Set(owned.map(f => f.id));
            const locked = FH_EXCL.allFx().filter(f => !ownedIds.has(f.id));
            const hint = document.createElement('div');
            hint.className = 'fxHint';
            hint.textContent = owned.length
                ? 'Toque num efeito para ver e equipar. Os outros jogadores veem quando você marca gol.'
                : '🔒 Todos os efeitos de gol são exclusivos e só a administração do ZunkoBall pode liberar para você.';
            // cadeado que abre: efeito liberado desde a última vez que você olhou esta aba
            let seen = null;
            try { seen = JSON.parse(localStorage.getItem('zb_fx_seen') || 'null'); } catch (e) {}
            const fresh = new Set(seen ? owned.filter(f => !seen.includes(f.id)).map(f => f.id) : []);
            try { localStorage.setItem('zb_fx_seen', JSON.stringify(owned.map(f => f.id))); } catch (e) {}
            list.append(hint);
            const mk = (spec, state) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'fxCard' + (spec.id === null ? ' none' : '') + (state === 'locked' ? ' locked' : '') + (state !== 'locked' && cur === spec.id ? ' active' : '') + (fresh.has(spec.id) ? ' justUnlocked' : '');
                b.style.setProperty('--fa', spec.a || '#2b2b36');
                b.style.setProperty('--fb', spec.b || '#15151c');
                const ic = document.createElement('span'), nm = document.createElement('span');
                ic.className = 'fxIcon'; ic.textContent = spec.icon;
                nm.className = 'fxName'; nm.textContent = spec.name;
                b.append(ic, nm);
                if (state === 'locked') {
                    const lk = document.createElement('span');
                    lk.className = 'fxLock';
                    lk.textContent = '🔒';
                    b.append(lk);
                } else if (fresh.has(spec.id)) {
                    const lk = document.createElement('span');
                    lk.className = 'fxLock open';
                    lk.textContent = '🔓';
                    b.append(lk);
                }
                b.addEventListener('click', () => selectFx(spec.id, state === 'locked'));
                list.append(b);
            };
            mk({ id: null, name: 'Nenhum', icon: '🚫' }, 'own');
            owned.forEach(f => mk(f, 'own'));
            locked.forEach(f => mk(f, 'locked'));
            list.scrollTop = keepTop;
        }
        function selectFx(id, isLocked) {
            if (isLocked) {
                fhAlert('🔒 Efeito exclusivo. Só a administração do ZunkoBall pode liberar na sua conta.');
                return;
            } else {
                FH_EXCL.equip('fx', id);
                fxView = id;
            }
            if (id)
                FH_GOALFX.replay(true);     // mostra de novo, desta vez com som
            buildFxList($('uniformList'));
            renderUniformScreen();
        }
        function centerActiveUniformCard() {
            const list = $('uniformList');
            const act = list.querySelector('.uniformCard.active');
            if (act)
                list.scrollLeft = act.parentElement.offsetLeft - (list.clientWidth - act.offsetWidth) / 2;
        }
        function drawGroundShadow(ctx, cx, cy, rx, ry) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.scale(1, ry / rx);
            const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
            g.addColorStop(0, 'rgba(0,0,0,.55)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(0, 0, rx, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        function renderUniformPreview(ts) {
            const cv = $('uniformPreview');
            const rect = cv.getBoundingClientRect();
            if (!rect.width || !rect.height)
                return;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
            if (cv.width !== w || cv.height !== h) {
                cv.width = w;
                cv.height = h;
            }
            const ctx = cv.getContext('2d');
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, w, h);
            const bob = Math.sin((ts || 0) / 600);
            if (uniformTarget === 'fx') {
                const id = fxViewId();
                if (id) {
                    FH_GOALFX.preview(ctx, w, h, id, ts || performance.now());
                } else {
                    ctx.fillStyle = 'rgba(255,255,255,.45)';
                    ctx.font = '700 ' + Math.round(h * .07) + 'px system-ui, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText('Sem efeito de gol', w / 2, h / 2);
                }
                return;
            }
            if (uniformTarget === 'ball') {
                const R = Math.min(rect.height * .33, rect.width * .33) * dpr;
                const cy = h * .5 - bob * R * .03;
                drawGroundShadow(ctx, w / 2, h * .5 + R * 1.04, R * (.86 - bob * .03), R * .17);
                Ball3D.draw(ctx, w / 2, cy, R, ballSpec3D(resolveUniform('ball')), { yaw: uni3d.yaw, pitch: uni3d.pitch });
            } else {
                const R = Math.min(rect.height * .31, rect.width * .2) * dpr;
                drawGroundShadow(ctx, w / 2, h * .5 + R * 1.12, R * (.9 - bob * .03), R * .16);
                ctx.setTransform(R, 0, 0, R, w / 2, h * .5 - bob * R * .03);
                drawPlayer(ctx, { x: 0, y: 0, r: 1, team: roomRole === 'blue' ? 'blue' : 'red' }, state.avatar, 0, true);
                ctx.setTransform(1, 0, 0, 1, 0, 0);
            }
        }
        function renderEditorPreview() {
            const cv = $('uniEdPreview');
            if (uniformTarget !== 'ball') {
                drawUniformSample(cv, 'player', editorSpec());
                return;
            }
            const ctx = cv.getContext('2d');
            const s = cv.width;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, s, s);
            drawGroundShadow(ctx, s / 2, s * .5 + s * .41, s * .34, s * .06);
            Ball3D.draw(ctx, s / 2, s * .48, s * .38, ballSpec3D(editorSpec()), { yaw: uni3d.yaw, pitch: uni3d.pitch });
        }
        function uniLoop(ts) {
            if (!$('uniformScreen').classList.contains('on')) {
                uni3d.raf = 0;
                return;
            }
            uni3d.raf = requestAnimationFrame(uniLoop);
            if (!uni3d.drag) {
                uni3d.spinV += ((uni3d.auto ? .011 : 0) - uni3d.spinV) * .04;
                uni3d.yaw += uni3d.spinV;
                uni3d.pitch += (.3 - uni3d.pitch) * .02;
            }
            if (!$('uniformEditor').hidden) {
                if (uniformTarget === 'ball')
                    renderEditorPreview();
            } else {
                renderUniformPreview(ts);
            }
        }
        function startUniLoop() {
            if (!uni3d.raf)
                uni3d.raf = requestAnimationFrame(uniLoop);
        }
        function renderUniformScreen() {
            const kind = uniformTarget;
            document.querySelectorAll('[data-uniform-target]').forEach(b => {
                const on = b.dataset.uniformTarget === kind;
                b.classList.toggle('active', on);
                b.setAttribute('aria-selected', String(on));
            });
            const current = customization[kind + 'Uniform'] || 'normal';
            document.querySelectorAll('.uniformCard[data-uniform]').forEach(card => card.classList.toggle('active', card.dataset.uniform === current));
            if (kind === 'fx') {
                const id = fxViewId(), spec = id && FH_EXCL.fxSpec(id), have = id && FH_EXCL.owns(id);
                $('uniKind').textContent = 'Efeito de gol';
                $('uniName').textContent = spec ? spec.name + (have ? '' : ' 🔒') : 'Nenhum';
                $('uniSpin').hidden = true;
                $('uniEditCur').hidden = true;
                $('uniHint').textContent = !spec ? 'Escolha um efeito na lista' : have ? 'Assim os outros veem quando você marca' : 'Exclusivo — ainda não liberado na sua conta';
                $('uniformPreview').classList.remove('draggable');
                renderUniformPreview(performance.now());
                return;
            }
            $('uniEditCur').hidden = false;
            $('uniKind').textContent = kind === 'ball' ? 'Bola 3D' : 'Uniforme do jogador';
            $('uniName').textContent = currentUniformItem(kind).name;
            $('uniSpin').hidden = kind !== 'ball';
            $('uniHint').textContent = kind === 'ball' ? 'Arraste para girar a bola' : 'Escolha um uniforme na lista';
            $('uniformPreview').classList.toggle('draggable', kind === 'ball');
            renderUniformPreview(performance.now());
        }
        function openUniforms() {
            show('uniformScreen');
            $('uniformEditor').hidden = true;
            buildUniformList();
            renderUniformScreen();
            requestAnimationFrame(() => { renderUniformPreview(performance.now()); centerActiveUniformCard(); });
            startUniLoop();
        }
        document.querySelectorAll('[data-uniform-target]').forEach(b => b.addEventListener('click', () => {
            uniformTarget = b.dataset.uniformTarget;
            $('uniformList').scrollLeft = 0;
            buildUniformList();
            renderUniformScreen();
            centerActiveUniformCard();
            if (uniformTarget === 'fx')   // confere se o admin liberou algo novo
                FH_EXCL.refresh().then(() => {
                    if (uniformTarget === 'fx') {
                        buildFxList($('uniformList'));
                        renderUniformScreen();
                    }
                });
        }));
        /* --- arrastar para girar a bola --- */
        (function () {
            const cv = $('uniformPreview');
            cv.addEventListener('pointerdown', e => {
                if (uniformTarget !== 'ball')
                    return;
                uni3d.drag = true;
                uni3d.lastX = e.clientX;
                uni3d.lastY = e.clientY;
                uni3d.lastDx = 0;
                cv.setPointerCapture(e.pointerId);
                cv.classList.add('grabbing');
            });
            cv.addEventListener('pointermove', e => {
                if (!uni3d.drag)
                    return;
                const dx = e.clientX - uni3d.lastX, dy = e.clientY - uni3d.lastY;
                uni3d.lastX = e.clientX;
                uni3d.lastY = e.clientY;
                uni3d.yaw += dx * .012;
                uni3d.pitch = Math.max(-1.1, Math.min(1.1, uni3d.pitch + dy * .01));
                uni3d.lastDx = dx * .012;
            });
            const end = () => {
                if (!uni3d.drag)
                    return;
                uni3d.drag = false;
                uni3d.spinV = Math.max(-.3, Math.min(.3, uni3d.lastDx));
                cv.classList.remove('grabbing');
            };
            cv.addEventListener('pointerup', end);
            cv.addEventListener('pointercancel', end);
        })();
        $('uniSpin').onclick = () => {
            uni3d.auto = !uni3d.auto;
            $('uniSpin').setAttribute('aria-pressed', String(uni3d.auto));
            $('uniSpin').classList.toggle('off', !uni3d.auto);
            $('uniSpin').querySelector('span').textContent = uni3d.auto ? 'Girando' : 'Parado';
        };
        $('uniEditCur').onclick = () => openUniformEditor(currentUniformItem(uniformTarget));
        /* --- Editor: criar ou modificar uniforme/bola por cores ou imagem --- */
        function editorSpec() {
            const d = editorDraft;
            if (d.mode === 'image')
                return { pattern: 'solid', base: uniformTarget === 'ball' ? '#ffffff' : '#000000', accent: '#000', img: d.img, zoom: d.zoom, x: d.x, y: d.y, gloss: d.gloss };
            return { pattern: d.pattern, base: d.base, accent: d.accent, text: d.text, line: d.line, gloss: d.gloss };
        }
        function newDraft() {
            const ball = uniformTarget === 'ball';
            return {
                mode: 'color', editId: null,
                pattern: ball ? 'classic' : 'stripes',
                base: '#ffffff', accent: ball ? '#15171a' : '#2563eb', line: '#2b2f36', gloss: 65, text: '#ffffff',
                src: '', img: null, zoom: 100, x: 50, y: 50, name: ''
            };
        }
        function draftFromItem(item) {
            const d = newDraft();
            const kind = uniformTarget;
            if (!item || item.id === 'normal') {
                if (kind === 'ball') {
                    d.pattern = 'solid';
                    d.base = customization.ballColor || '#ffffff';
                }
                return d;
            }
            if (item.type === 'image') {
                d.mode = 'image';
                d.src = item.src;
                d.img = uniformItemSpec(item).img;
                d.zoom = item.zoom;
                d.x = item.x;
                d.y = item.y;
            } else {
                d.pattern = item.pattern || d.pattern;
                d.base = item.base || d.base;
                d.accent = item.accent || d.accent;
                d.text = item.text || d.text;
            }
            if (item.line)
                d.line = item.line;
            if (item.gloss != null)
                d.gloss = item.gloss;
            const custom = uniformLibrary[kind].includes(item);
            d.editId = custom ? item.id : null;
            d.name = custom ? item.name : item.name + ' (meu)';
            return d;
        }
        function fillPatternOptions() {
            const list = uniformTarget === 'ball' ? PATTERNS_BALL : PATTERNS_PLAYER;
            $('uniEdPattern').innerHTML = list.map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('');
        }
        function renderUniformEditor() {
            const d = editorDraft;
            const ball = uniformTarget === 'ball';
            $('uniEdTitle').textContent = d.editId ? (ball ? 'Editar bola 3D' : 'Editar uniforme') : (ball ? 'Nova bola 3D' : 'Novo uniforme');
            document.querySelectorAll('[data-uni-mode]').forEach(b => b.classList.toggle('active', b.dataset.uniMode === d.mode));
            $('uniEdColor').hidden = d.mode !== 'color';
            $('uniEdImage').hidden = d.mode !== 'image';
            $('uniEdAccentRow').hidden = d.pattern === 'solid' || (ball && d.pattern === 'seams');
            const lineUsed = ball && ['classic', 'wedges', 'seams'].includes(d.pattern);
            $('uniEdLineRow').hidden = !lineUsed;
            $('uniEdLineLabel').textContent = d.pattern === 'wedges' ? 'Cor 3' : d.pattern === 'classic' ? 'Costuras' : 'Linhas';
            $('uniEdTextRow').hidden = ball;
            $('uniEdGlossRow').hidden = !ball;
            $('uniEdGlossVal').textContent = d.gloss;
            $('uniEdSave').disabled = d.mode === 'image' && !d.src;
            renderEditorPreview();
        }
        function openUniformEditor(item) {
            editorDraft = draftFromItem(item);
            const d = editorDraft;
            fillPatternOptions();
            if (![...$('uniEdPattern').options].some(o => o.value === d.pattern))
                d.pattern = $('uniEdPattern').options[0].value;
            $('uniEdName').value = d.name || '';
            $('uniEdPattern').value = d.pattern;
            $('uniEdBase').value = d.base;
            $('uniEdAccent').value = d.accent;
            $('uniEdLine').value = d.line;
            $('uniEdText').value = d.text;
            $('uniEdGloss').value = d.gloss;
            $('uniEdZoom').value = d.zoom;
            $('uniEdX').value = d.x;
            $('uniEdY').value = d.y;
            $('uniformEditor').hidden = false;
            renderUniformEditor();
        }
        document.querySelectorAll('[data-uni-mode]').forEach(b => b.addEventListener('click', () => {
            editorDraft.mode = b.dataset.uniMode;
            renderUniformEditor();
        }));
        [['uniEdPattern', 'pattern'], ['uniEdBase', 'base'], ['uniEdAccent', 'accent'], ['uniEdLine', 'line'], ['uniEdText', 'text']].forEach(([id, key]) =>
            $(id).addEventListener('input', () => { editorDraft[key] = $(id).value; renderUniformEditor(); }));
        [['uniEdZoom', 'zoom'], ['uniEdX', 'x'], ['uniEdY', 'y'], ['uniEdGloss', 'gloss']].forEach(([id, key]) =>
            $(id).addEventListener('input', () => { editorDraft[key] = +$(id).value; renderUniformEditor(); }));
        $('uniEdChoose').onclick = () => $('uniEdFile').click();
        $('uniEdFile').addEventListener('change', () => readImageFile($('uniEdFile'), data => {
            editorDraft.src = data;
            editorDraft.img = new Image();
            editorDraft.img.onload = renderUniformEditor;
            editorDraft.img.src = data;
            renderUniformEditor();
        }));
        $('uniEdCancel').onclick = () => { $('uniformEditor').hidden = true; };
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && !$('uniformEditor').hidden)
                $('uniformEditor').hidden = true;
        });
        $('uniEdSave').onclick = () => {
            const d = editorDraft, kind = uniformTarget;
            const list = uniformLibrary[kind];
            const name = $('uniEdName').value.trim() || ((kind === 'ball' ? 'Minha bola ' : 'Meu uniforme ') + (list.length + 1));
            const item = { id: d.editId || 'u' + Date.now().toString(36), name, type: d.mode };
            if (d.mode === 'image')
                Object.assign(item, { src: d.src, zoom: d.zoom, x: d.x, y: d.y });
            else
                Object.assign(item, { pattern: d.pattern, base: d.base, accent: (d.pattern === 'solid' || d.pattern === 'seams') ? d.base : d.accent, text: d.text, line: d.line });
            if (kind === 'ball')
                item.gloss = d.gloss;
            let undo;
            if (d.editId) {
                const idx = list.findIndex(i => i.id === d.editId);
                const old = list[idx];
                list[idx] = item;
                undo = () => { list[idx] = old; };
            } else {
                list.push(item);
                undo = () => { list.pop(); };
            }
            if (!saveUniformLibrary()) {
                undo();
                return;
            }
            $('uniformEditor').hidden = true;
            selectUniform(item.id);
            buildUniformList();
            renderUniformScreen();
            centerActiveUniformCard();
        };

        /* ===== TELA CHEIA + ESCALA DOS MENUS (celular com barra do navegador) ===== */
        function toggleFullscreen() {
            const d = document;
            if (d.fullscreenElement || d.webkitFullscreenElement) {
                (d.exitFullscreen || d.webkitExitFullscreen).call(d);
                return;
            }
            const el = d.documentElement;
            const req = el.requestFullscreen || el.webkitRequestFullscreen;
            if (!req)
                return;
            const p = req.call(el, { navigationUI: 'hide' });
            const lock = () => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) {} };
            if (p && p.then)
                p.then(lock).catch(() => {});
            else
                lock();
        }
        function applyMenuZoom() {
            const s = Math.max(.6, Math.min(1, innerHeight / 430, innerWidth / 800));
            document.documentElement.style.setProperty('--fh-zoom', s.toFixed(3));
        }
        applyMenuZoom();
        addEventListener('resize', applyMenuZoom);
        addEventListener('orientationchange', applyMenuZoom);
        ['homeFull', 'nickFull', 'settingsFull'].forEach(id => { if ($(id)) $(id).addEventListener('click', toggleFullscreen); });
        document.addEventListener('fullscreenchange', () => { applyMenuZoom(); setTimeout(applyMenuZoom, 250); });
        let uniformReturn = 'lobbyScreen';
        $('uniformBack').onclick = () => show(uniformReturn);
        $('uniformsBtn').onclick = () => { uniformReturn = 'lobbyScreen'; openUniforms(); };

        /* ===== TELA INICIAL (home): perfil, personagem + bola, inventário, guilda, partida rápida ===== */
        const homeAnim = { raf: 0, yaw: .4, pitch: .3, t: 0 };
        function openHome() {
            $('homeNick').textContent = state.nick;
            $('homeAvatar').textContent = state.avatar;
            if (!homeAnim.raf)
                homeAnim.raf = requestAnimationFrame(homeLoop);
        }
        function homeLoop(ts) {
            if (!$('homeScreen').classList.contains('on')) {
                homeAnim.raf = 0;
                return;
            }
            homeAnim.raf = requestAnimationFrame(homeLoop);
            renderHome(ts);
        }
        function renderHome(ts) {
            const cv = $('homeHero');
            const rect = cv.getBoundingClientRect();
            if (!rect.width || !rect.height)
                return;
            const dpr = Math.min(window.devicePixelRatio || 1, 2);
            const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
            if (cv.width !== w || cv.height !== h) {
                cv.width = w;
                cv.height = h;
            }
            const ctx = cv.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, rect.width, rect.height);
            const W = rect.width, H = rect.height;
            const R = Math.min(W * .26, H * .27);
            const t = ts / 1000;
            const bob = Math.sin(t * 1.6) * R * .04;
            const px = W * .46, py = H * .46 + bob;
            const br = R * .46;
            const bx = px + R * 1.12, by = H * .46 + R * .62 - Math.abs(Math.sin(t * 1.6 + 1)) * R * .05;
            const baseY = H * .46 + R * 1.02;
            ctx.fillStyle = '#23252c';
            ctx.beginPath();
            ctx.ellipse(px, baseY + R * .16, R * 1.22, R * .26, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#3a3d47';
            ctx.beginPath();
            ctx.ellipse(px, baseY, R * 1.22, R * .26, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#15171c';
            ctx.beginPath();
            ctx.ellipse(px, baseY - R * .02, R * .98, R * .19, 0, 0, Math.PI * 2);
            ctx.fill();
            drawPlayer(ctx, { x: px, y: py, r: R, team: 'red' }, state.avatar, 0, true);
            ctx.beginPath();
            ctx.arc(px, py, R * .9335, 0, Math.PI * 2);   // cobre exatamente a faixa preta do boneco (.867R a R): borda colada, sem vão
            ctx.strokeStyle = '#000';
            ctx.lineWidth = R * .133;
            ctx.stroke();
            {
                const pw = Math.max(R * 1.5, 120), ph = R * .34, pyy = baseY + R * .34;
                ctx.beginPath();
                ctx.moveTo(px - pw / 2 + ph * .3, pyy);
                ctx.lineTo(px + pw / 2 - ph * .3, pyy);
                ctx.lineTo(px + pw / 2, pyy + ph);
                ctx.lineTo(px - pw / 2, pyy + ph);
                ctx.closePath();
                ctx.fillStyle = '#0c1744';
                ctx.fill();
                ctx.lineWidth = 3;
                ctx.strokeStyle = '#1d2a78';
                ctx.stroke();
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                let fs = ph * .62;
                ctx.font = '800 ' + fs + 'px Poppins, Arial, sans-serif';
                while (ctx.measureText(state.nick).width > pw * .8 && fs > 8) {
                    fs -= 1;
                    ctx.font = '800 ' + fs + 'px Poppins, Arial, sans-serif';
                }
                ctx.fillText(state.nick, px, pyy + ph / 2 + 1);
            }
            drawGroundShadow(ctx, bx, by + br * 1.05, br * 1.1, br * .2);
            homeAnim.yaw += .012;
            if (window.Ball3D)
                Ball3D.draw(ctx, bx, by, br, ballSpec3D(resolveUniform('ball')), { yaw: homeAnim.yaw, pitch: homeAnim.pitch });
        }
        function homeToast(msg) {
            const el = $('homeToast');
            el.textContent = msg;
            el.classList.add('on');
            clearTimeout(homeToast.t);
            homeToast.t = setTimeout(() => el.classList.remove('on'), 2200);
        }
        function openHomeUniforms() {
            uniformReturn = 'homeScreen';
            openUniforms();
        }
        const DISCORD_URL = 'https://discord.gg/jjK6m4KJJR';
        const openDiscord = () => window.open(DISCORD_URL, '_blank', 'noopener');
        let homeMode = 'futsal';
        try {
            const m = localStorage.getItem('fh_quick_mode');
            if (m === 'futsal' || m === 'real')
                homeMode = m;
        } catch (e) {}
        function setHomeMode(m) {
            homeMode = m;
            try { localStorage.setItem('fh_quick_mode', m); } catch (e) {}
            document.querySelectorAll('[data-home-mode]').forEach(b => {
                const on = b.dataset.homeMode === m || (m && MAP_CATALOG[m] === undefined && b.dataset.homeMode === (m[0] === 'r' ? 'real' : 'futsal'));
                b.classList.toggle('on', on);
                b.setAttribute('aria-checked', String(on));
            });
        }
        document.querySelectorAll('[data-home-mode]').forEach(b => b.addEventListener('click', () => setHomeMode(b.dataset.homeMode)));
        const homeModeSelect = $('homeModeSelect');
        if (homeModeSelect) {
            const savedMap = localStorage.getItem('fh_home_map') || (MAP_CATALOG[homeMode] && MAP_CATALOG[homeMode].def) || 'v3';
            if ([...homeModeSelect.options].some(o => o.value === savedMap)) homeModeSelect.value = savedMap;
            homeModeSelect.addEventListener('change', () => {
                const key = homeModeSelect.value;
                localStorage.setItem('fh_home_map', key);
                setHomeMode(key[0] === 'r' ? 'real' : 'futsal');
            });
        }
        setHomeMode(homeMode);
        $('homeInventory').onclick = openHomeUniforms;
        $('homeHero').onclick = openHomeUniforms;
        $('homeProfile').onclick = () => show('nickScreen');
        $('homeConfig').onclick = () => openSettings('homeScreen');
        $('homeCommunity').onclick = openDiscord;
        $('homeSocial').onclick = openDiscord;
        $('homeGuild').onclick = () => homeToast('Clubes chegam em breve!');
        $('homeRanking').onclick = () => homeToast('Ranking chega em breve!');
        $('homeFriends').onclick = () => homeToast('Amigos chegam em breve!');
        $('homeRooms').onclick = () => show('lobbyScreen');
        $('lobbyHome').onclick = () => show('homeScreen');
        /* Modalidade da tela inicial: Partida rápida (treino local) ou Ranqueado (busca de adversário).
           O seletor de formato (Futsal 1v1…Real 11v11) vale para as duas. */
        let homeModality = 'quick';
        try { if (localStorage.getItem('fh_home_modality') === 'ranked') homeModality = 'ranked'; } catch (e) {}
        const homeModalitySel = $('homeModality');
        function applyHomeModality() {
            const ranked = homeModality === 'ranked';
            if (homeModalitySel) homeModalitySel.value = homeModality;
            const ic = $('homeQuickIcon'), lb = $('homeQuickLabel');
            if (ic) ic.textContent = ranked ? '🏅' : '⚽';
            if (lb) lb.textContent = ranked ? 'Ranqueado' : 'Partida rápida';
            document.dispatchEvent(new CustomEvent('fh-home-change'));
        }
        if (homeModalitySel) homeModalitySel.addEventListener('change', () => {
            homeModality = homeModalitySel.value === 'ranked' ? 'ranked' : 'quick';
            try { localStorage.setItem('fh_home_modality', homeModality); } catch (e) {}
            applyHomeModality();
        });
        if (homeModeSelect) homeModeSelect.addEventListener('change', () => document.dispatchEvent(new CustomEvent('fh-home-change')));
        applyHomeModality();
        $('homeQuick').onclick = () => {
            if (homeModality === 'ranked') {
                const fmt = homeModeSelect ? homeModeSelect.value : 'v3';
                if (window.FH_RANKED_HOME) FH_RANKED_HOME.play(fmt);
                return;
            }
            window.__fhForceLocal = true;               // jogo rápido continua sendo treino local contra a IA
            if ($('roomName'))
                $('roomName').value = state.nick + ' — Jogo rápido';
            if ($('roomStyle'))
                $('roomStyle').value = homeMode;
            if ($('fieldVariant')) $('fieldVariant').value = homeModeSelect ? homeModeSelect.value : (MAP_CATALOG[homeMode] ? MAP_CATALOG[homeMode].def : 'v3');
            $('doCreate').click();
        };


        /* ===== SEÇÃO 5 - BOTÕES DOS MENUS (lobby, criar sala, pausa, reiniciar) ===== */
        $('loginForm').onsubmit = (event) => {
            event.preventDefault();
            state.nick = $('nick').value.trim() || 'Jogador';
            state.avatar = Array.from($('avatar').value.trim()).slice(0, 2).join('') || 'P1';
            $('avatar').value = state.avatar;
            localStorage.setItem('mb_classic_nick', state.nick);
            localStorage.setItem('mb_classic_avatar', state.avatar);
            roomRole = 'red';
            roomOwnerId = null;
            updateRoomOwnerControls();
            localStorage.setItem('mb_room_role', 'red');
            resetRoomPlayers();
            state.roomMode = 'local';
            mode = 'local';
            fieldVariant = 'v3';
            mapKey = 'v3';
            if ($('roomName'))
                $('roomName').value = state.nick + " — Sala";
            show('homeScreen');
        }
        ;
        $('refresh').onclick = () => {
            if (window.FH_ONLINE) FH_ONLINE.refreshRooms();       // lista real vem do servidor (online.js)
            else $('roomCount').textContent = '0 jogadores em 0 salas.'
        }
        ;
        $('config').onclick = () => {
            openSettings('lobbyScreen')
        }
        ;
        $('settingsBack').onclick = () => show(settingsReturnScreen);
        $('createBtn').onclick = () => show('createScreen');
        $('profileBtn').onclick = () => show('nickScreen');
        $('cancelCreate').onclick = () => show('lobbyScreen');
        if ($('settingsBtn'))
            $('settingsBtn').onclick = () => openSettings('lobbyScreen');
        $('roomPause').onclick = () => openSettings('roomScreen');
        $('applySettings').onclick = () => {
            state.settings = {
                sound: $('setSound').value,
                player: $('setPlayer').value,
                gamepad: $('setGamepad').value,
                kick: $('setKick').value,
                size: $('setSize').value,
                pos: $('setPos').value,
                keyboard: $('setKeyboard').value,
                shout: $('setShout').value,
                hideMobileControls: $('setHideMobileControls').checked
            };
            saveSettings();
            applyHUD();
            if (state.settings.sound === 'off') {
                pauseCrowd();
                pauseGameMusic()
            } else
                startGameMusic();
            show(settingsReturnScreen)
        }
        ;
        $('defaultSettings').onclick = () => {
            state.settings = {
                sound: 'on',
                player: '1',
                gamepad: 'dynamic',
                kick: 'static',
                size: 'medium',
                pos: 'left',
                keyboard: 'on',
                shout: 'on',
                hideMobileControls: false
            };
            Object.assign(keyBindings, keyBindingDefaults);
            try {
                localStorage.setItem('mb_key_bindings', JSON.stringify(keyBindings))
            } catch (error) {
                console.error('Não foi possível restaurar as teclas padrão:', error)
            }
            activeKeyBinding = null;
            renderKeyBindings();
            Object.assign(customization, customizationDefaults);
            Object.assign(gameChatSettings, gameChatDefaults);
            syncGameChatSettings();
            saveGameChatSettings();
            Object.assign(graphicsSettings, graphicsDefaults);
            syncGraphicsControls();
            saveGraphicsSettings();
            if (engine)
                resize();
            loadSettings();
            applyHUD();
            const hudDefaults = {
                joySize: 142,
                stickSize: 1,
                kickSize: 1,
                hudOpacity: 1,
                gameZoom: 1,
                cameraOffset: 0,
                cameraStyle: 1
            };
            Object.entries(hudDefaults).forEach(([id, value]) => {
                $(id).value = value
            });
            applyGameHUD();
            syncSettingsHud();
            loadCustomizationControls();
            saveCustomization()
        }
        ;
        function LAUNCH_CREATE() {
            if (engine)
                stop();
            pauseGameMusic();
            const gm = $('gameMusic');
            if (gm)
                gm.currentTime = 0;
            show('game');
            create();
            resize();
            if (!engine)
                throw new Error('O motor do jogo não foi criado');
            engine.running = true;
            engine.paused = false;
            engine.last = performance.now();
            startCrowdAudio();
            requestAnimationFrame(loop);
        }
        /* ===== CRIAR SALA: visualizador de mapas deslizável + modo de jogo ===== */
        (function initMapPicker() {
            const viewer = $('mapViewer'), track = $('mapTrack'), info = $('mapInfo'), dots = $('mapDots');
            const styleSel = $('roomStyle'), hidden = $('fieldVariant');
            if (!viewer || !track || !info || !styleSel || typeof MAP_CATALOG === 'undefined') return;
            let style = 'futsal', index = 0, slideW = 0, drag = 0, dragging = false, startX = 0, moved = false, startT = 0;
            try {
                const s = localStorage.getItem('mb_create_style');
                if (MAP_CATALOG[s]) style = s;
            } catch (e) {}
            styleSel.value = style;
            const list = () => MAP_CATALOG[style].maps;
            function defaultIndex() {
                const i = list().findIndex(m => m.key === MAP_CATALOG[style].def);
                return i < 0 ? 0 : i;
            }
            function previewSVG(key) {
                const m = MAPS[key], W = m.PlayerAreaSettings.width, H = m.PlayerAreaSettings.height;
                const L = m.BallAreaSettings.Line, x1 = L[0].x1, x2 = L[0].x2, y1 = L[0].y1, y2 = L[1].y1;
                const w = x2 - x1, h = y2 - y1, cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
                const lw = Math.max(.14, w * .006);
                const g = m.GoalProperty.GoalLine[0], goalH = g.y2 - g.y1, goalD = m.GoalProperty.GoalSettings.GoalDept;
                const futsal = m.style !== 'real', th = courtTheme();
                const grass = !futsal || th.grass;
                let floor = '';
                if (grass) {
                    floor = `<rect width="${W}" height="${H}" rx="${Math.min(W, H) * .03}" fill="#25502b"/>`;
                    const n = 12, sw = w / n;
                    for (let i = 0; i < n; i++)
                        floor += `<rect x="${x1 + i * sw}" y="${y1}" width="${sw}" height="${h}" fill="${i % 2 ? '#2f6535' : '#3b7a42'}"/>`;
                } else {
                    floor = `<rect width="${W}" height="${H}" rx="${Math.min(W, H) * .03}" fill="${th.outer}"/>` +
                        `<rect x="${x1}" y="${y1}" width="${w}" height="${h}" fill="${th.court}"/>`;
                    if (th.wood) {
                        const pl = h / 12;
                        for (let i = 0; i < 12; i++)
                            floor += `<rect x="${x1}" y="${y1 + i * pl}" width="${w}" height="${pl}" fill="${i % 2 ? 'rgba(90,50,15,.12)' : 'rgba(255,230,180,.08)'}"/>`;
                    }
                    floor += `<polygon points="${x1 + w * .2},${y1} ${x1 + w * .34},${y1} ${x1 + w * .24},${y2} ${x1 + w * .1},${y2}" fill="rgba(255,255,255,.09)"/>`;
                }
                const st = `fill="none" stroke="#fff" stroke-opacity=".92" stroke-width="${lw}"`;
                let marks;
                if (futsal) {
                    const R = Math.min(h * .3, w * .22), gTop = (g.y1 + g.y2) / 2 - goalH / 2, gBot = gTop + goalH;
                    const D = (sx, dir) => `<path d="M ${sx},${gTop - R} A ${R} ${R} 0 0 ${dir > 0 ? 1 : 0} ${sx + dir * R},${gTop} L ${sx + dir * R},${gBot} A ${R} ${R} 0 0 ${dir > 0 ? 1 : 0} ${sx},${gBot + R}" ${st}/>` +
                        `<circle cx="${sx + dir * R}" cy="${cy}" r="${lw * .9}" fill="#fff"/>`;
                    marks = D(x1, 1) + D(x2, -1);
                } else {
                    const pd = w * 16.5 / 105, ph = h * 40.32 / 68 / 2, gd = w * 5.5 / 105, gh = h * 18.32 / 68 / 2;
                    marks = `<rect x="${x1}" y="${cy - ph}" width="${pd}" height="${ph * 2}" ${st}/>
                    <rect x="${x2 - pd}" y="${cy - ph}" width="${pd}" height="${ph * 2}" ${st}/>
                    <rect x="${x1}" y="${cy - gh}" width="${gd}" height="${gh * 2}" ${st}/>
                    <rect x="${x2 - gd}" y="${cy - gh}" width="${gd}" height="${gh * 2}" ${st}/>`;
                }
                return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${floor}
                    <rect x="${x1}" y="${y1}" width="${w}" height="${h}" ${st}/>
                    <line x1="${cx}" y1="${y1}" x2="${cx}" y2="${y2}" ${st}/>
                    <circle cx="${cx}" cy="${cy}" r="${w * 9.15 / 105}" ${st}/>
                    <circle cx="${cx}" cy="${cy}" r="${lw * 1.1}" fill="#fff"/>${marks}
                    <rect x="${x1 - goalD}" y="${g.y1}" width="${goalD}" height="${goalH}" fill="rgba(229,72,77,.35)" stroke="#e5484d" stroke-width="${lw * 1.3}"/>
                    <rect x="${x2}" y="${g.y1}" width="${goalD}" height="${goalH}" fill="rgba(62,139,255,.35)" stroke="#3e8bff" stroke-width="${lw * 1.3}"/>
                </svg>`;
            }
            function build() {
                track.innerHTML = '';
                dots.innerHTML = '';
                list().forEach((mp, i) => {
                    const sl = document.createElement('div');
                    sl.className = 'mapSlide';
                    sl.innerHTML = previewSVG(mp.key) + '<span class="mapSlideName"></span>';
                    sl.querySelector('.mapSlideName').textContent = mp.name;
                    sl.addEventListener('click', () => { if (!moved) go(i); });
                    track.appendChild(sl);
                    const d = document.createElement('button');
                    d.type = 'button';
                    d.className = 'mapDot';
                    d.setAttribute('aria-label', mp.name);
                    d.addEventListener('click', () => go(i));
                    dots.appendChild(d);
                });
            }
            function renderInfo() {
                const mp = list()[index], m = MAPS[mp.key];
                const L = m.BallAreaSettings.Line, g = m.GoalProperty.GoalLine[0];
                const rows = [
                    ['Modo', MAP_CATALOG[style].label],
                    ['Campo', Math.round(L[0].x2 - L[0].x1) + ' × ' + Math.round(L[1].y1 - L[0].y1)],
                    ['Gol', (g.y2 - g.y1).toFixed(1)],
                    ['Ideal', (mp.team * 2) + ' jogadores'],
                    ['Regras', style === 'real' ? 'Lateral e escanteio' : 'Com paredes']
                ];
                info.innerHTML = '<strong class="mapInfoName"></strong>' + rows.map(r => '<div class="mapInfoRow"><span>' + r[0] + '</span><b>' + r[1] + '</b></div>').join('');
                info.querySelector('.mapInfoName').textContent = mp.name;
            }
            function layout(animate) {
                slideW = viewer.clientWidth * .78;
                const slides = track.children;
                for (let i = 0; i < slides.length; i++) {
                    slides[i].style.width = slideW + 'px';
                    slides[i].classList.toggle('active', i === index);
                    dots.children[i].classList.toggle('active', i === index);
                }
                track.style.transition = animate ? 'transform .32s cubic-bezier(.2,.8,.2,1)' : 'none';
                track.style.transform = 'translateX(' + ((viewer.clientWidth - slideW) / 2 - index * slideW + drag) + 'px)';
                $('mapPrev').disabled = index === 0;
                $('mapNext').disabled = index === list().length - 1;
            }
            const swatches = $('courtSwatches'), courtPicker = $('courtPicker');
            function buildSwatches() {
                if (!swatches) return;
                swatches.innerHTML = '';
                COURT_THEMES.forEach(t => {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'courtSwatch' + (t.key === courtTheme().key ? ' active' : '');
                    b.title = t.name;
                    b.setAttribute('role', 'radio');
                    b.setAttribute('aria-checked', String(t.key === courtTheme().key));
                    b.setAttribute('aria-label', t.name);
                    b.style.background = `linear-gradient(135deg, ${t.outer} 0 38%, ${t.court} 38% 100%)`;
                    b.addEventListener('click', () => {
                        setCourtKey(t.key);
                        buildSwatches();
                        const keep = index;
                        build();
                        index = keep;
                        layout(false);
                    });
                    swatches.appendChild(b);
                });
            }
            function go(i) {
                index = Math.max(0, Math.min(list().length - 1, i));
                drag = 0;
                hidden.value = list()[index].key;
                try { localStorage.setItem('mb_create_map', hidden.value); } catch (e) {}
                renderInfo();
                layout(true);
            }
            function setStyle(s, keepKey) {
                style = s;
                try { localStorage.setItem('mb_create_style', style); } catch (e) {}
                if (courtPicker) courtPicker.style.display = style === 'futsal' ? '' : 'none';
                buildSwatches();
                build();
                const k = list().findIndex(m => m.key === keepKey);
                index = k >= 0 ? k : defaultIndex();
                hidden.value = list()[index].key;
                renderInfo();
                layout(false);
                track.classList.remove('swap');
                void track.offsetWidth;
                track.classList.add('swap');
            }
            styleSel.addEventListener('change', () => setStyle(styleSel.value));
            $('mapPrev').addEventListener('click', () => go(index - 1));
            $('mapNext').addEventListener('click', () => go(index + 1));
            viewer.addEventListener('pointerdown', e => {
                if (e.target.closest('.mapArrow, .mapDot')) return;
                dragging = true; moved = false; startX = e.clientX; startT = performance.now(); drag = 0;
                try { viewer.setPointerCapture(e.pointerId); } catch (err) {}
            });
            viewer.addEventListener('pointermove', e => {
                if (!dragging) return;
                drag = e.clientX - startX;
                if (Math.abs(drag) > 6) moved = true;
                if ((index === 0 && drag > 0) || (index === list().length - 1 && drag < 0)) drag *= .35;
                layout(false);
            });
            function endDrag() {
                if (!dragging) return;
                dragging = false;
                const dx = drag, fast = Math.abs(dx) > 30 && performance.now() - startT < 250;
                if (Math.abs(dx) > slideW * .2 || fast) go(index + (dx < 0 ? 1 : -1));
                else { drag = 0; layout(true); }
                setTimeout(() => { moved = false; }, 0);
            }
            viewer.addEventListener('pointerup', endDrag);
            viewer.addEventListener('pointercancel', endDrag);
            viewer.addEventListener('wheel', e => {
                if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && Math.abs(e.deltaX) > 20) {
                    e.preventDefault();
                    go(index + (e.deltaX > 0 ? 1 : -1));
                }
            }, { passive: false });
            document.addEventListener('keydown', e => {
                if (!$('createScreen').classList.contains('on')) return;
                if (e.target instanceof Element && e.target.matches('input, select, textarea')) return;
                if (e.key === 'ArrowLeft') go(index - 1);
                else if (e.key === 'ArrowRight') go(index + 1);
            });
            if (window.ResizeObserver) new ResizeObserver(() => layout(false)).observe(viewer);
            else window.addEventListener('resize', () => layout(false));
            let savedKey = null;
            try { savedKey = localStorage.getItem('mb_create_map'); } catch (e) {}
            setStyle(style, savedKey);
        })();
        $('doCreate').onclick = () => {
            state.roomMode = 'local';
            mode = state.roomMode;
            fieldVariant = $('fieldVariant').value || 'v3';
            mapKey = fieldVariant || 'v3';
            localStorage.setItem('mb_room_mode', state.roomMode);
            roomRole = 'red';
            roomOwnerId = 'self';
            updateRoomOwnerControls();
            localStorage.setItem('mb_room_role', 'red');
            roomChatMessages = [];
            renderRoomChat();
            resetRoomPlayers();
            if ($('roomTitle'))
                $('roomTitle').textContent = ($('roomName').value || state.nick + " — Sala") + ' • ' + mapLabel(fieldVariant);
            syncRoomConfigInputs();
            playRoomDing();
            show('roomScreen');
        }
        ;
        $('roomChatForm').addEventListener('submit', sendRoomChatMessage);
        $('gameChatForm').addEventListener('submit', sendRoomChatMessage);
        $('gameChatToggle').addEventListener('click', () => {
            const open = $('gameChat').classList.toggle('open');
            $('gameChatToggle').setAttribute('aria-expanded', String(open));
            applyGameChatSettings();
            if (open)
                $('gameChatInput').focus()
        });
        document.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || event.repeat || !engine ||
                !$('game').classList.contains('on') || !gameChatSettings.enabled)
                return;
            const chatOpen = $('gameChat').classList.contains('open');
            const chatInputFocused = event.target === $('gameChatInput');
            if (chatInputFocused && $('gameChatInput').value.trim())
                return;
            event.preventDefault();
            if (chatOpen) {
                $('gameChat').classList.remove('open');
                $('gameChatToggle').setAttribute('aria-expanded', 'false');
                $('gameChatInput').blur();
                return
            }
            if (event.target instanceof Element &&
                event.target.matches('input, textarea, select, button, [contenteditable="true"]'))
                return;
            $('gameChat').classList.add('open');
            $('gameChatToggle').setAttribute('aria-expanded', 'true');
            applyGameChatSettings();
            $('gameChatInput').focus()
        }, true);
        function leaveRoomToLobby(e) {
            if (window.FH_ONLINE)
                FH_ONLINE.leave();
            e?.preventDefault();
            e?.stopPropagation();
            teamWindowFromGame = false;
            $('roomScreen').classList.remove('teamWindow');
            $('game').classList.remove('teamWindowOpen');
            $('startRoom').textContent = 'Iniciar partida';
            stop();
            roomOwnerId = null;
            roomChatMessages = [];
            renderRoomChat();
            updateRoomOwnerControls();
            show('lobbyScreen')
        }
        $('leaveRoom').onclick = leaveRoomToLobby;
        $('leaveRoom').onpointerup = leaveRoomToLobby;
        $('startRoom').onclick = () => {
            if (teamWindowFromGame) {
                closeTeamWindow();
                return
            }
            mode = state.roomMode;
            if ($('roomFieldVariant')) {
                fieldVariant = $('roomFieldVariant').value || 'v3';
                mapKey = fieldVariant || 'v3'
            } else if ($('fieldVariant')) {
                fieldVariant = $('fieldVariant').value || 'v1';
                mapKey = fieldVariant || 'v3'
            }
            start()
        }
        ;
        $('stopRoom').onclick = () => {
            if (!isRoomOwner()) return;
            fhConfirm('Parar a partida e liberar as configurações da sala?', { ok: 'Parar' }).then(yes => {
                if (!yes) return;
                if (engine && engine.online && window.FH_ONLINE) window.FH_ONLINE.requestStop();
                else {
                    if (engine) stop();
                    show('roomScreen');
                    updateRoomOwnerControls();
                }
            });
        };
        function goRoom(e) {
            if (window.FH_RANKED && FH_RANKED.active())
                return;
            if (teamWindowFromGame || !engine || !$('game').classList.contains('on'))
                return;
            e?.preventDefault();
            e?.stopPropagation();
            teamWindowFromGame = true;
            teamWindowWasPaused = engine.paused;
            engine.paused = teamWindowWasPaused || isRoomOwner();
            pauseCrowdAudio();
            pauseGameMusic();
            $('game').classList.add('teamWindowOpen');
            $('roomScreen').classList.add('on', 'teamWindow');
            $('startRoom').textContent = 'Voltar à partida';
            renderRoomPlayers();
        }
        function closeTeamWindow() {
            if (!teamWindowFromGame)
                return;
            teamWindowFromGame = false;
            if (!$('game').classList.contains('on'))
                show('game');
            $('roomScreen').classList.remove('on', 'teamWindow');
            $('game').classList.remove('teamWindowOpen');
            $('startRoom').textContent = 'Iniciar partida';
            if (!engine)
                return;
            spectatorMode = roomRole === 'spectator';
            $('game').classList.toggle('spectatorMode', spectatorMode);
            if (engine.players[0])
                engine.players[0].team = roomRole === 'blue' ? 'blue' : 'red';
            engine.paused = teamWindowWasPaused;
            $('pauseOv').classList.toggle('on', engine.paused);
            engine.last = performance.now();
            if (!spectatorMode && !engine.paused)
                startCrowdAudio()
        }
        let restartWasPaused = false;
        function finishMatchAndReturnToRoom() {
            if (!engine)
                return;
            if (window.FH_RANKED && FH_RANKED.handleFinish())
                return;
            teamWindowFromGame = false;
            if ($('roomScreen')) {
                $('roomScreen').classList.remove('on', 'teamWindow');
                $('startRoom').textContent = 'Iniciar partida';
            }
            if ($('game'))
                $('game').classList.remove('teamWindowOpen', 'spectatorMode');
            stopCrowd();
            stop();
            show('roomScreen')
        }
        function scheduleMatchFinish(matchEngine) {
            if (matchEngine.finishReturnScheduled)
                return;
            matchEngine.finishReturnScheduled = true;
            if (window.FH_REC && FH_REC.active())
                FH_REC.finalize('normal').catch(() => {});
            else if (window.FH_REC)
                FH_REC.cancel();
            if (window.FH_RANKED)
                FH_RANKED.onMatchEnd(matchEngine);
            setTimeout(() => {
                if (engine !== matchEngine || matchEngine.running)
                    return;
                finishMatchAndReturnToRoom();
            }, 850);
        }
        function handleGameEscape(e) {
            if (e.key !== 'Escape')
                return;
            const onGameScreen = $('game') && $('game').classList.contains('on');
            const teamMenuOpen = teamWindowFromGame || ($('roomScreen') && $('roomScreen').classList.contains('on') && !$('game').classList.contains('on'));
            if (!onGameScreen && !teamMenuOpen)
                return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (teamMenuOpen) {
                closeTeamWindow();
                return
            }
            if (engine)
                goRoom()
        }
        document.addEventListener('keydown', handleGameEscape, true);
        function goLobby(e) {
            e?.preventDefault();
            e?.stopPropagation();
            if (teamWindowFromGame) {
                teamWindowFromGame = false;
                $('roomScreen').classList.remove('on', 'teamWindow');
                $('game').classList.remove('teamWindowOpen')
            }
            if ($('restartRoomModal'))
                $('restartRoomModal').classList.remove('on');
            const doLeave = () => {
                if (window.FH_ONLINE)
                    FH_ONLINE.leave();
                if (window.FH_REC)
                    FH_REC.cancel();
                stopCrowd();
                stop();
                $('game').classList.remove('rankedMatch');
                show(window.FH_RANKED ? FH_RANKED.exitScreen() : 'lobbyScreen')
            };
            if (window.FH_RANKED && FH_RANKED.active())
                fhConfirm('Sair agora conta como derrota na ranqueada. Deseja sair?', { ok: 'Sair', danger: true }).then(yes => { if (yes) doLeave(); });
            else
                doLeave();
        }
        function resumePause(e) {
            e?.preventDefault();
            e?.stopPropagation();
            togglePause()
        }
        function openRestartRoom() {
            if (window.FH_RANKED && FH_RANKED.active())
                return;
            if (!engine || !isRoomOwner() || teamWindowFromGame)
                return;
            $('restartRoomModal').classList.add('on');
            engine.restartPrompt = true;
            restartWasPaused = engine.paused;
            engine.paused = true;
            $('pauseOv').classList.remove('on');
            pauseCrowdAudio();
            pauseGameMusic()
        }
        function closeRestartRoom() {
            if ($('restartRoomModal'))
                $('restartRoomModal').classList.remove('on');
            if (engine) {
                engine.restartPrompt = false;
                engine.paused = restartWasPaused;
                restartWasPaused = false;
                engine.last = performance.now();
                $('pauseOv').classList.toggle('on', engine.paused);
                if (!spectatorMode && !engine.paused)
                    startCrowdAudio();
            }
        }
        function confirmRestartRoom() {
            if (!engine || !isRoomOwner())
                return;
            $('restartRoomModal').classList.remove('on');
            engine.restartPrompt = false;
            restartWasPaused = false;
            if (engine.online && window.FH_ONLINE) { engine.paused = false; FH_ONLINE.requestRestart(); return; }      // online: o servidor reinicia para todos
            engine.red = 0;
            engine.blue = 0;
            engine.time = roomTimeSeconds();
            engine.running = true;
            engine.paused = true;
            engine.finishReturnScheduled = false;
            engine.goalAnim = null;
            engine.kick = false;
            engine.pass = false;
            engine.kickBuffer = 0;
            engine.passBuffer = 0;
            engine.keys.clear();
            engine.touch.active = false;
            engine.touch.x = 0;
            engine.touch.y = 0;
            engine.players[0].team = roomRole === 'blue' ? 'blue' : 'red';
            reset();
            teamWindowFromGame = false;
            $('roomScreen').classList.remove('on', 'teamWindow');
            $('game').classList.remove('teamWindowOpen');
            $('pauseOv').classList.remove('on');
            $('startRoom').textContent = 'Iniciar partida';
            $('pauseGame').textContent = '⏸';
            $('pauseGame').setAttribute('aria-label', 'Pausar partida');
            $('pauseGame').title = 'Pausar partida';
            show('game');
            pauseCrowdAudio();
            pauseGameMusic();
            if (kickoffTimer)
                clearTimeout(kickoffTimer);
            kickoffTimer = null;
            engine.last = performance.now();
            showKickoff()
        }
        $('exit').onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            openRestartRoom()
        }
        ;
        $('pauseGame').onclick = togglePause;
        $('pause').onclick = goRoom;
        $('resume').onclick = resumePause;
        $('back').onclick = goLobby;
        $('restartNo').onclick = closeRestartRoom;
        $('restartYes').onclick = confirmRestartRoom;
        /* ===== SEÇÃO 6 - SPRITES (bola e skins dos jogadores) ===== */
        const redSkinImg = new Image();
        redSkinImg.decoding = 'async';
        redSkinImg.src = RED_SKIN_SRC;
        const blueSkinImg = new Image();
        blueSkinImg.decoding = 'async';
        blueSkinImg.src = BLUE_SKIN_SRC;
        function drawCustomizationPreviewBall() {
            const canvas = document.querySelector('#customizationPreview .previewBall');
            if (!canvas)
                return;
            const context = canvas.getContext('2d');
            if (!context)
                return;
            const scale = canvas.width / 20;
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.save();
            context.setTransform(scale, 0, 0, scale, canvas.width / 2, canvas.height / 2);
            paintBall(context, 10, resolveUniform('ball'), true);
            context.restore();
        }
        /* ===== UNIFORMES (jogador e bola) — padrões desenhados em canvas ===== */
        function resolveUniform(kind) {
            const id = customization[kind + 'Uniform'];
            if (!id || id === 'normal')
                return null;
            if (kind === 'player' && String(id).startsWith('x-'))   // exclusivo: só vale se a conta ainda tiver o item
                return FH_EXCL.owns(id) ? FH_EXCL.kitSpec(id) : null;
            const item = (kind === 'ball' && BALL_PRESETS.find(u => u.id === id)) || UNIFORMS.find(u => u.id === id) || uniformLibrary[kind].find(u => u.id === id);
            return uniformItemSpec(item);
        }
        // Pinta o padrão do uniforme num quadrado centrado em (0,0); o chamador já aplicou o clip circular.
        function paintUniformPattern(c, r, u) {
            c.fillStyle = u.base;
            c.fillRect(-r, -r, r * 2, r * 2);
            if (u.img) {
                if (u.img.complete && u.img.naturalWidth)
                    drawCustomizedImage(c, u.img, r, u.zoom, u.x, u.y);
                return;
            }
            c.fillStyle = u.accent;
            const step = r * 2 / 5;
            switch (u.pattern) {
            case 'stripes':
                for (let i = 0; i < 5; i += 2)
                    c.fillRect(-r + i * step, -r, step, r * 2);
                break;
            case 'hoops':
                for (let i = 0; i < 5; i += 2)
                    c.fillRect(-r, -r + i * step, r * 2, step);
                break;
            case 'halves':
                c.fillRect(0, -r, r, r * 2);
                break;
            case 'speed':
                c.save();
                c.rotate(-.42);
                for (const [y, h] of [[-.8, .16], [-.4, .3], [.1, .3], [.62, .16]])
                    c.fillRect(-r * 1.6, r * y, r * 3.2, r * h);
                c.restore();
                break;
            case 'sash':
                c.save();
                c.rotate(-Math.PI / 4);
                c.fillRect(-r * 1.5, -r * .3, r * 3, r * .6);
                c.restore();
                break;
            case 'classic': {
                c.fillStyle = u.accent;
                const pent = (px, py, rad, rot) => {
                    c.beginPath();
                    for (let i = 0; i < 5; i++) {
                        const a = rot + i * Math.PI * 2 / 5;
                        const x = px + Math.cos(a) * rad, y = py + Math.sin(a) * rad;
                        i ? c.lineTo(x, y) : c.moveTo(x, y);
                    }
                    c.closePath();
                    c.fill();
                };
                pent(0, 0, r * .34, -Math.PI / 2);
                for (let k = 0; k < 5; k++) {
                    const a = -Math.PI / 2 + Math.PI / 5 + k * Math.PI * 2 / 5;
                    pent(Math.cos(a) * r * .95, Math.sin(a) * r * .95, r * .3, a + Math.PI);
                }
                break;
            }
            case 'wedges': {
                const cols = [u.base, u.accent, u.line || '#ffffff'];
                for (let i = 0; i < 6; i++) {
                    c.fillStyle = cols[i % 3];
                    c.beginPath();
                    c.moveTo(0, 0);
                    c.arc(0, 0, r * 1.5, i * Math.PI / 3, (i + 1) * Math.PI / 3);
                    c.closePath();
                    c.fill();
                }
                break;
            }
            case 'seams':
                c.strokeStyle = u.line || '#111';
                c.lineWidth = r * .09;
                c.beginPath();
                c.moveTo(-r, 0); c.lineTo(r, 0); c.moveTo(0, -r); c.lineTo(0, r);
                c.stroke();
                c.beginPath(); c.arc(-r * 1.55, 0, r * 1.1, -.9, .9); c.stroke();
                c.beginPath(); c.arc(r * 1.55, 0, r * 1.1, Math.PI - .9, Math.PI + .9); c.stroke();
                break;
            case 'gradient': {
                const g = c.createLinearGradient(0, -r, 0, r);
                g.addColorStop(0, u.accent);
                g.addColorStop(1, u.base);
                c.fillStyle = g;
                c.fillRect(-r, -r, r * 2, r * 2);
                break;
            }
            case 'dots':
                c.fillStyle = u.accent;
                [[0, 0], [.6, .55], [-.6, .55], [.6, -.55], [-.6, -.55], [0, -.95], [0, .95], [.98, 0], [-.98, 0]].forEach(([x, y]) => {
                    c.beginPath();
                    c.arc(x * r, y * r, r * .2, 0, Math.PI * 2);
                    c.fill();
                });
                break;
            case 'checker':
                for (let i = 0; i < 4; i++)
                    for (let j = 0; j < 4; j++)
                        if ((i + j) % 2 === 0)
                            c.fillRect(-r + i * r / 2, -r + j * r / 2, r / 2, r / 2);
                break;
            }
        }
        // Corpo da bola: imagem personalizada > uniforme > cor sólida. useImage=false ignora a imagem (miniaturas).
        function paintBall(c, radius, uniform, useImage) {
            if (useImage && customization.ballImage && customBallImg.complete && customBallImg.naturalWidth) {
                drawCustomizedImage(c, customBallImg, radius, customization.ballZoom, customization.ballX, customization.ballY);
                return;
            }
            if (uniform) {
                c.save();
                c.beginPath();
                c.arc(0, 0, radius, 0, Math.PI * 2);
                c.clip();
                paintUniformPattern(c, radius, uniform);
                c.restore();
            } else {
                c.fillStyle = customization.ballColor;
                c.beginPath();
                c.arc(0, 0, radius, 0, Math.PI * 2);
                c.fill();
            }
            c.beginPath();
            c.arc(0, 0, radius, 0, Math.PI * 2);
            c.strokeStyle = '#000';
            c.lineWidth = Math.max(.025, radius * .1);
            c.stroke();
        }
        function drawCustomizedImage(c, image, radius, zoom, horizontal, vertical) {
            const size = radius * 2 * zoom / 100;
            const x = (50 - horizontal) / 50 * radius * .8;
            const y = (50 - vertical) / 50 * radius * .8;
            c.save();
            c.beginPath();
            c.arc(0, 0, radius, 0, Math.PI * 2);
            c.clip();
            c.drawImage(image, x - size / 2, y - size / 2, size, size);
            c.restore()
        }
        customBallImg.onload = () => {
            drawCustomizationPreviewBall();
            if (engine)
                draw()
        };
        customPlayerImg.onload = () => {
            if (engine)
                draw()
        };
        function applyCustomization() {
            const root = document.documentElement;
            const color = customization.themeColor;
            const rgb = color.match(/^#([0-9a-f]{6})$/i);
            if (rgb) {
                const parts = [0, 2, 4].map(i => parseInt(rgb[1].slice(i, i + 2), 16));
                const blend = amount => '#' + parts.map(value => Math.round(value * amount).toString(16).padStart(2, '0')).join('');
                const lighten = amount => '#' + parts.map(value => Math.round(value + (255 - value) * amount).toString(16).padStart(2, '0')).join('');
                root.style.setProperty('--theme-purple', color);
                root.style.setProperty('--theme-purple-dark', blend(.78));
                root.style.setProperty('--theme-purple-light', lighten(.88))
            }
            root.style.setProperty('--custom-field-line', customization.lineColor);
            document.body.classList.toggle('custom-dark', customization.dark);
            $('customizationPreview').style.setProperty('--preview-line', customization.lineColor);
            $('customizationPreview').style.setProperty('--preview-player-image', customization.playerImage ? `url("${customization.playerImage}")` : 'none');
            $('customizationPreview').style.setProperty('--preview-player-zoom', customization.playerZoom + '%');
            $('customizationPreview').style.setProperty('--preview-player-x', customization.playerX + '%');
            $('customizationPreview').style.setProperty('--preview-player-y', customization.playerY + '%');
            if (customization.ballImage) {
                if (customBallImg.getAttribute('src') !== customization.ballImage)
                    customBallImg.src = customization.ballImage;
            } else {
                customBallImg.removeAttribute('src');
            }
            if (customization.playerImage) {
                if (customPlayerImg.getAttribute('src') !== customization.playerImage)
                    customPlayerImg.src = customization.playerImage;
            } else {
                customPlayerImg.removeAttribute('src');
            }
            drawCustomizationPreviewBall();
            if ($('uniformScreen').classList.contains('on'))
                renderUniformScreen();
            if (engine)
                draw()
        }
        function saveCustomization() {
            try {
                localStorage.setItem('mb_customization', JSON.stringify(customization))
            } catch (error) {
                console.error('Não foi possível salvar a personalização:', error);
                fhAlert('Não foi possível salvar. Remova uma imagem ou escolha um arquivo menor e tente novamente.')
            }
        }
        function updateCustomizationFromControls() {
            customization.dark = $('customDark').checked;
            customization.themeColor = $('customThemeColor').value;
            customization.lineColor = $('customLineColor').value;
            customization.ballColor = $('customBallColor').value;
            customization.ballZoom = +$('customBallZoom').value;
            customization.ballX = +$('customBallX').value;
            customization.ballY = +$('customBallY').value;
            customization.playerZoom = +$('customPlayerZoom').value;
            customization.playerX = +$('customPlayerX').value;
            customization.playerY = +$('customPlayerY').value;
            saveCustomization();
            applyCustomization()
        }
        function loadCustomizationControls() {
            $('customDark').checked = customization.dark;
            $('customThemeColor').value = customization.themeColor;
            $('customLineColor').value = customization.lineColor;
            $('customBallColor').value = customization.ballColor;
            $('customBallZoom').value = customization.ballZoom;
            $('customBallX').value = customization.ballX;
            $('customBallY').value = customization.ballY;
            $('customPlayerZoom').value = customization.playerZoom;
            $('customPlayerX').value = customization.playerX;
            $('customPlayerY').value = customization.playerY;
            applyCustomization()
        }
        // Lê e valida o arquivo de imagem de um <input type=file> (usado nas Configurações e na tela de Uniformes).
        function readImageFile(input, onData) {
            const file = input.files && input.files[0];
            if (!file)
                return;
            if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
                fhAlert('Escolha uma imagem PNG, JPG, GIF ou WebP.');
                input.value = '';
                return
            }
            if (file.size > 512 * 1024) {
                fhAlert('A imagem deve ter no máximo 512 KB.');
                input.value = '';
                return
            }
            const reader = new FileReader();
            reader.onerror = () => {
                fhAlert('Não foi possível ler a imagem selecionada.');
                input.value = ''
            };
            reader.onload = () => {
                onData(String(reader.result));
                input.value = ''
            };
            reader.readAsDataURL(file)
        }
        function loadCustomizationImage(inputId, key) {
            const input = $(inputId);
            input.addEventListener('change', () => readImageFile(input, data => {
                customization[key] = data;
                saveCustomization();
                applyCustomization();
            }))
        }
        function clearCustomizationImage(key) {
            customization[key] = '';
            saveCustomization();
            applyCustomization()
        }
        /* ===== SEÇÃO 7 - CRIAÇÃO DA PARTIDA E ÁUDIO (torcida, música, contagem 3-2-1) ===== */
        function create() {
            const c = $('canvas');
            const m = MAPS[mapKey] || MAPS.classic;
            const ctx = c.getContext('2d', {
                alpha: false
            });
            spectatorMode = roomRole === 'spectator';
            engine = {
                c,
                ctx,
                m,
                running: true,
                paused: false,
                last: performance.now(),
                time: roomTimeSeconds(),
                red: 0,
                blue: 0,
                kick: false,
                pass: false,
                kickBuffer: 0,
                passBuffer: 0,
                kickFlash: 0,
                passFlash: 0,
                goalAnim: null,
                finishReturnScheduled: false,
                postSoundCd: 0,
                keys: new Set(),
                touch: {
                    x: 0,
                    y: 0,
                    active: false
                },
                kickFlash: 0,
                players: [{
                    team: 'red',
                    x: Math.max(2.8, m.PlayerAreaSettings.width * 0.267),
                    y: m.PlayerAreaSettings.height / 2,
                    vx: 0,
                    vy: 0,
                    r: .68,
                    mass: m.PlayerProperty.density
                }, {
                    team: 'blue',
                    x: m.PlayerAreaSettings.width - Math.max(2.8, m.PlayerAreaSettings.width * 0.267),
                    y: m.PlayerAreaSettings.height / 2,
                    vx: 0,
                    vy: 0,
                    r: .68,
                    mass: m.PlayerProperty.density
                }],
                ball: {
                    x: m.PlayerAreaSettings.width / 2,
                    y: m.PlayerAreaSettings.height / 2,
                    vx: 0,
                    vy: 0,
                    // Raio físico = raio desenhado (antes a bola era desenhada 28% maior e parecia entrar no boneco).
                    r: m.BallProperty.radius * 1.28,
                    mass: m.BallProperty.density,
                    angle: 0
                }
            };
            engine.players[0].team = roomRole === 'blue' ? 'blue' : 'red';
            if (roomRole === 'blue') {
                engine.players[0].x = m.PlayerAreaSettings.width - Math.max(2.8, m.PlayerAreaSettings.width * 0.267)
            } else {
                engine.players[0].x = Math.max(2.8, m.PlayerAreaSettings.width * 0.267)
            }
            engine.players[0].nick = state.nick;
            engine.players[0].avatar = state.avatar;
            engine.players[1].team = 'blue';
            const aiNames = ['kevin', 'mtsete', 'zaza', 'glx', 'jadejade', 'shin', 'musiala', 'guxta', 'zlzin', 'davizin', 'fabulous', 'rockstar', 'k9', 'kante', 'kroos', 'm10', 'pelezinhogod', 'frost', 'mito', 'ghost', 'speed', 'zika', 'bruxo', 'trem bala', 'fint', 'showtime', 'golaço', 'capita'];
            let previousAiName = sessionStorage.getItem('mb_previous_ai_nick') || '';
            let availableAiNames = aiNames.filter(n => n !== previousAiName);
            const aiNick = availableAiNames[Math.floor(Math.random() * availableAiNames.length)];
            engine.players[1].nick = aiNick;
            sessionStorage.setItem('mb_previous_ai_nick', aiNick);
            c.setAttribute('aria-label', 'ZunkoBall');
            bindKeys();
        }
        function configureCrowd() {
            const a = $('crowdAudio');
            if (!a)
                return;
            const enabled = $('crowdEnabled') ? $('crowdEnabled').checked : localStorage.getItem('mb_crowd_enabled') !== 'off';
            const vol = $('crowdVolume') ? +$('crowdVolume').value : Number(localStorage.getItem('mb_crowd_volume') ?? 0.20);
            const rawVol = Math.max(0, Math.min(.45, vol));
            a.volume = Math.max(0, Math.min(1, rawVol * masterVolume));
            a.muted = !enabled;
            localStorage.setItem('mb_crowd_enabled', enabled ? 'on' : 'off');
            localStorage.setItem('mb_crowd_volume', String(rawVol));
            if (crowdFallbackNodes[0] && crowdFallbackNodes[0].gain)
                crowdFallbackNodes[0].gain.value = Math.max(.015 * (masterVolume > 0 ? 1 : 0), Math.min(.16, (rawVol || .16) * .42)) * masterVolume
        }
        let crowdFallbackCtx = null
          , crowdFallbackNodes = [];
        function startCrowdFallback() {
            try {
                if (!$('crowdEnabled')?.checked)
                    return;
                if (crowdFallbackCtx && crowdFallbackCtx.state === 'running')
                    return;
                const C = window.AudioContext || window.webkitAudioContext;
                if (!C)
                    return;
                if (!crowdFallbackCtx)
                    crowdFallbackCtx = new C();
                crowdFallbackCtx.resume();
                const ctx = crowdFallbackCtx
                  , master = ctx.createGain();
                master.gain.value = Math.max(.015, Math.min(.16, (+$('crowdVolume').value || .16) * .42)) * masterVolume;
                master.connect(ctx.destination);
                crowdFallbackNodes = [master];
                for (const band of [{
                    f: 420,
                    q: .7,
                    g: .72
                }, {
                    f: 1050,
                    q: 1.1,
                    g: .30
                }, {
                    f: 185,
                    q: .8,
                    g: .35
                }]) {
                    const n = Math.floor(ctx.sampleRate * 4)
                      , buf = ctx.createBuffer(1, n, ctx.sampleRate)
                      , d = buf.getChannelData(0);
                    let v = 0;
                    for (let i = 0; i < n; i++) {
                        v = v * .94 + (Math.random() * 2 - 1) * .06;
                        d[i] = v * 2.8
                    }
                    const src = ctx.createBufferSource();
                    src.buffer = buf;
                    src.loop = true;
                    const filter = ctx.createBiquadFilter();
                    filter.type = 'bandpass';
                    filter.frequency.value = band.f;
                    filter.Q.value = band.q;
                    const gain = ctx.createGain();
                    gain.gain.value = band.g;
                    src.connect(filter).connect(gain).connect(master);
                    src.start();
                    crowdFallbackNodes.push(src, filter, gain)
                }
                const lfo = ctx.createOscillator()
                  , lg = ctx.createGain();
                lfo.frequency.value = .16;
                lg.gain.value = .035;
                lfo.connect(lg).connect(master.gain);
                lfo.start();
                crowdFallbackNodes.push(lfo, lg)
            } catch (err) {
                console.warn('Áudio ambiente alternativo indisponível:', err)
            }
        }
        function stopCrowdFallback() {
            for (const n of crowdFallbackNodes) {
                try {
                    if (n.stop)
                        n.stop()
                } catch {}
                try {
                    if (n.disconnect)
                        n.disconnect()
                } catch {}
            }
            crowdFallbackNodes = []
        }
        function startCrowdAudio() {
            const a = $('crowdAudio');
            configureCrowd();
            if (!$('crowdEnabled')?.checked)
                return;
            if (a) {
                a.onerror = () => {
                    a.pause();
                    startCrowdFallback()
                }
                ;
                a.currentTime = 0;
                const promise = a.play();
                if (promise && promise.catch)
                    promise.catch( () => startCrowdFallback());
                setTimeout( () => {
                    if (a.paused)
                        startCrowdFallback()
                }
                , 900)
            } else
                startCrowdFallback()
        }
        /* stopCrowd era chamada em goLobby/finishMatchAndReturnToRoom mas nunca foi definida (ReferenceError ao sair da partida). */
        function stopCrowd() {
            pauseCrowdAudio();
        }
        function pauseCrowdAudio() {
            const a = $('crowdAudio');
            if (a)
                a.pause();
            stopCrowdFallback()
        }
        let footballMusicCtx = null
          , footballMusicTimer = null
          , footballMusicOn = false
          , footballMusicStep = 0;
        function entranceNote(freq, duration, when, kind='triangle', level=.045) {
            if (!footballMusicCtx)
                return;
            const o = footballMusicCtx.createOscillator()
              , g = footballMusicCtx.createGain();
            o.type = kind;
            o.frequency.setValueAtTime(freq, when);
            g.gain.setValueAtTime(.0001, when);
            g.gain.exponentialRampToValueAtTime(Math.max(.0002, level * masterVolume), when + .018);
            g.gain.exponentialRampToValueAtTime(.0001, when + duration);
            o.connect(g).connect(footballMusicCtx.destination);
            o.start(when);
            o.stop(when + duration + .025)
        }
        /* Música nova: torcida/estádio, 126 BPM, Am–F–C–G, com bateria, baixo, pad e melodia */
        let musicNext = 0, musicNoise = null;
        const MUSIC_S16 = 60 / 126 / 4;
        const mHz = m => 440 * Math.pow(2, (m - 69) / 12);
        const MUSIC_LEAD = [
            [76,0,0,76, 0,74,72,0, 76,0,0,0, 79,0,76,0],
            [77,0,0,77, 0,76,74,0, 72,0,0,0, 77,0,74,0],
            [76,0,0,76, 0,74,72,0, 67,0,72,0, 76,0,79,0],
            [74,0,0,74, 0,71,74,0, 79,0,0,0, 74,0,71,0]
        ];
        const MUSIC_BASS = [45, 41, 48, 43];
        const MUSIC_PAD = [[57,60,64], [53,57,60], [60,64,67], [55,59,62]];
        function musicNoiseBurst(when, dur, level, hp) {
            const c = footballMusicCtx;
            if (!musicNoise) {
                musicNoise = c.createBuffer(1, c.sampleRate, c.sampleRate);
                const d = musicNoise.getChannelData(0);
                for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            }
            const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
            src.buffer = musicNoise; f.type = 'highpass'; f.frequency.value = hp;
            g.gain.setValueAtTime(Math.max(.0002, level * masterVolume), when);
            g.gain.exponentialRampToValueAtTime(.0001, when + dur);
            src.connect(f).connect(g).connect(c.destination);
            src.start(when); src.stop(when + dur + .02);
        }
        function musicKick(when) {
            const c = footballMusicCtx, k = c.createOscillator(), g = c.createGain();
            k.type = 'sine';
            k.frequency.setValueAtTime(150, when);
            k.frequency.exponentialRampToValueAtTime(45, when + .12);
            g.gain.setValueAtTime(Math.max(.0002, .22 * masterVolume), when);
            g.gain.exponentialRampToValueAtTime(.0001, when + .2);
            k.connect(g).connect(c.destination); k.start(when); k.stop(when + .22);
        }
        function playMusicStep(n, when) {
            const bar = Math.floor(n / 16) % 4, st = n % 16;
            const lead = MUSIC_LEAD[bar][st];
            if (lead) {
                entranceNote(mHz(lead), MUSIC_S16 * 2.6, when, 'square', .02);
                entranceNote(mHz(lead) * 2.003, MUSIC_S16 * 2.2, when, 'triangle', .016);
            }
            if (st === 0) MUSIC_PAD[bar].forEach(m => entranceNote(mHz(m), MUSIC_S16 * 15, when, 'sine', .016));
            if ([0, 3, 6, 8, 11, 14].includes(st)) entranceNote(mHz(MUSIC_BASS[bar]), MUSIC_S16 * 2.4, when, 'triangle', .085);
            if (st % 4 === 0) musicKick(when);
            if (st === 4 || st === 12) musicNoiseBurst(when, .13, .07, 1500);
            if (st % 2 === 0) musicNoiseBurst(when, st === 14 ? .12 : .035, st === 14 ? .022 : .03, 7000);
        }
        function footballBeat() {
            if (!footballMusicCtx || !footballMusicOn) return;
            while (musicNext < footballMusicCtx.currentTime + .25) {
                playMusicStep(footballMusicStep++ % 64, musicNext);
                musicNext += MUSIC_S16;
            }
        }
        function startGameMusic() {
            try {
                if (state.settings.sound === 'off')
                    return;
                if (!footballMusicCtx)
                    footballMusicCtx = new (window.AudioContext || window.webkitAudioContext)();
                footballMusicCtx.resume();
                footballMusicOn = true;
                footballMusicStep = 0;
                musicNext = footballMusicCtx.currentTime + .08;
                clearInterval(footballMusicTimer);
                footballBeat();
                footballMusicTimer = setInterval(footballBeat, 50)
            } catch (err) {
                console.warn('Música de entrada indisponível:', err)
            }
        }
        function pauseGameMusic() {
            footballMusicOn = false;
            clearInterval(footballMusicTimer);
            footballMusicTimer = null;
            if (footballMusicCtx && footballMusicCtx.state === 'running')
                footballMusicCtx.suspend().catch( () => {}
                )
        }
        let kickoffTimer = null;
        function showKickoff() {
            startCrowdAudio();
            const game = $('game');
            let overlay = $('kickoffOverlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'kickoffOverlay';
                overlay.style.cssText = 'position:absolute;inset:0;z-index:110;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.48);color:#fff;font:900 clamp(54px,13vw,112px) Poppins,Arial,sans-serif;text-shadow:0 5px 22px #000;text-align:center;pointer-events:none;';
                game.appendChild(overlay)
            }
            let seq = ['3', '2', '1', 'GO!']
              , i = 0;
            overlay.textContent = seq[i];
            const tick = () => {
                i++;
                if (i < seq.length) {
                    overlay.textContent = seq[i];
                    if (seq[i] === 'GO!')
                        playGoalCue();
                    kickoffTimer = setTimeout(tick, 720)
                } else {
                    kickoffTimer = setTimeout( () => {
                        overlay.remove();
                        kickoffTimer = null;
                        if (engine) {
                            engine.paused = teamWindowFromGame;
                            engine.last = performance.now()
                        }
                        pauseGameMusic()
                    }
                    , 520)
                }
            }
            ;
            kickoffTimer = setTimeout(tick, 720)
        }
        let displayRequestBound = false;
        function bindDisplayRequest() {
            if (displayRequestBound)
                return;
            displayRequestBound = true;
            const once = () => {
                requestGameDisplay();
                ['pointerdown', 'touchend', 'keydown'].forEach(ev => document.removeEventListener(ev, once, true))
            }
            ;
            ['pointerdown', 'touchend', 'keydown'].forEach(ev => document.addEventListener(ev, once, true))
        }
        bindDisplayRequest();
        function requestGameDisplay() {
            const root = document.documentElement;
            try {
                if (!document.fullscreenElement && root.requestFullscreen)
                    root.requestFullscreen().catch( () => {}
                    );
            } catch (e) {}
            try {
                if (screen.orientation && screen.orientation.lock)
                    screen.orientation.lock('landscape').catch( () => {}
                    );
            } catch (e) {}
        }
        /* ===== SEÇÃO 8 - CONTROLE DA PARTIDA (iniciar, parar, pausar) ===== */
        function startMatch(retry=false) {
            requestGameDisplay();
            if (engine)
                stop();
            mode = state.roomMode || mode || 'local';
            mapKey = mapKey || fieldVariant || 'v3';
            show('game');
            create();
            resize();
            $('game').classList.toggle('spectatorMode', spectatorMode);
            engine.running = true;
            engine.paused = true;
            engine.last = performance.now();
            // Gravação de replay: só partidas locais / contra a IA (o online é gravado no servidor).
            if (window.FH_REC) {
                if (mode !== 'online' && !engine.replay && !(window.FH_RANKED && FH_RANKED.active()))
                    FH_REC.start({ map: mapKey, style: fieldVariant, scoreLimit: roomConfig.scoreLimit, timeLimit: roomConfig.timeLimit },
                        (engine.players || []).map(p => ({ nick: p.nick, avatar: p.avatar, team: p.team })));
                else
                    FH_REC.cancel();
            }
            pauseCrowdAudio();
            if (kickoffTimer) {
                clearTimeout(kickoffTimer);
                kickoffTimer = null
            }
            pauseGameMusic();
            showKickoff();
            requestAnimationFrame(loop);
        }
        function start() {
            startMatch();
        }
        function stop() {
            if (kickoffTimer) {
                clearTimeout(kickoffTimer);
                kickoffTimer = null
            }
            const ko = $('kickoffOverlay');
            if (ko)
                ko.remove();
            pauseCrowdAudio();
            pauseGameMusic();
            const a = $('crowdAudio');
            if (a)
                a.currentTime = 0;
            if (engine && engine.online && window.FH_ONLINE)
                FH_ONLINE.onStop(engine);
            if (window.FH_RANKED)
                FH_RANKED.onStop(engine);
            engine = null
        }
        function togglePause() {
            if (engine && engine.online && window.FH_ONLINE) {      // online: o servidor pausa (todos congelam); só o dono
                if (isRoomOwner() && !engine.restartPrompt && !teamWindowFromGame) FH_ONLINE.requestPause();
                return;
            }
            if (!engine || engine.online || !isRoomOwner() || engine.restartPrompt || teamWindowFromGame)
                return;
            engine.paused = !engine.paused;
            $('pauseOv').classList.toggle('on', engine.paused);
            $('pauseGame').textContent = engine.paused ? '▶' : '⏸';
            $('pauseGame').setAttribute('aria-label', engine.paused ? 'Continuar partida' : 'Pausar partida');
            $('pauseGame').title = engine.paused ? 'Continuar partida' : 'Pausar partida';
            if (engine.paused) {
                pauseCrowdAudio();
                pauseGameMusic()
            } else {
                startCrowdAudio()
            }
        }
        let bound = false;
        const actionTouchGate = {
            active: new Map(),
            lastDown: 0
        };
        /* ===== SEÇÃO 9 - ENTRADA (teclado, toques, botões chute/passe, joystick) ===== */
        function acceptActionTouch(e, kind) {
            if (e.pointerType === 'mouse')
                return true;
            const now = performance.now();
            // Bloqueia toque simultâneo nos dois botões e também repetição ultra-rápida
            // no mesmo botão. Menos de 15 ms entre acionamentos não é aceito.
            if (actionTouchGate.active.size > 0)
                return false;
            if (now - actionTouchGate.lastDown < 15)
                return false;
            actionTouchGate.active.set(e.pointerId, kind);
            actionTouchGate.lastDown = now;
            return true;
        }
        function releaseActionTouch(e) {
            if (e.pointerType !== 'mouse')
                actionTouchGate.active.delete(e.pointerId)
        }
        function bindKeys() {
            if (bound)
                return;
            bound = true;
            addEventListener('keydown', e => {
                if (e.target instanceof Element && e.target.closest('#gameChat'))
                    return;
                if (e.key === 'Escape' && engine && $('game').classList.contains('on')) {
                    goRoom(e);
                    return
                }
                const k = normalizeKey(e);
                if (Object.values(keyBindings).includes(k))
                    e.preventDefault();
                if (engine && [keyBindings.up, keyBindings.down, keyBindings.left, keyBindings.right].includes(k))
                    engine.keys.add(k);
                if (k === keyBindings.kick) {
                    if (engine) {
                        if (!e.repeat) {
                            engine.kickBuffer = 0.2;
                            if (engine.online) engine.online.pressKick();
                            engine.kickFlash = .22
                        }
                    }
                }
                if (k === keyBindings.pass) {
                    if (engine && !e.repeat) {
                        engine.passBuffer = 0.2;
                        if (engine.online) engine.online.pressPass();
                    }
                }
                if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k))
                    e.preventDefault()
            }
            );
            addEventListener('keyup', e => {
                const k = normalizeKey(e);
                engine?.keys.delete(k);
            }
            );
            $('kick').addEventListener('pointerdown', e => {
                e.preventDefault();
                if (hudMoveMode === 'kick') {
                    moveHudTo(e, 'kick');
                    $('kick').setPointerCapture(e.pointerId);
                    return
                }
                if (!acceptActionTouch(e, 'kick'))
                    return;
                if (engine) {
                    engine.kickBuffer = 0.2;
                    if (engine.online) engine.online.pressKick();
                    engine.kickFlash = .22
                }
            }
            );
            $('kick').addEventListener('pointermove', e => {
                if (hudMoveMode === 'kick')
                    moveHudTo(e, 'kick')
            }
            );
            $('kick').addEventListener('pointerup', e => {
                if (hudMoveMode === 'kick') {
                    stopHudMove();
                    saveGameHud();
                    return
                }
                releaseActionTouch(e);
            }
            );
            $('kick').addEventListener('pointercancel', e => {
                if (hudMoveMode === 'kick') {
                    stopHudMove();
                    saveGameHud();
                    return
                }
                releaseActionTouch(e);
            }
            );
            $('pass').addEventListener('pointerdown', e => {
                e.preventDefault();
                if (hudMoveMode === 'pass') {
                    moveHudTo(e, 'pass');
                    $('pass').setPointerCapture(e.pointerId);
                    return
                }
                if (!acceptActionTouch(e, 'pass'))
                    return;
                if (engine) {
                    engine.passBuffer = 0.2;
                    if (engine.online) engine.online.pressPass();
                }
            }
            );
            $('pass').addEventListener('pointermove', e => {
                if (hudMoveMode === 'pass')
                    moveHudTo(e, 'pass')
            }
            );
            $('pass').addEventListener('pointerup', e => {
                if (hudMoveMode === 'pass') {
                    stopHudMove();
                    saveGameHud();
                    return
                }
                releaseActionTouch(e);
            }
            );
            $('pass').addEventListener('pointercancel', e => {
                if (hudMoveMode === 'pass') {
                    stopHudMove();
                    saveGameHud();
                    return
                }
                releaseActionTouch(e);
            }
            );
            const gameEl = $('game');
            gameEl.addEventListener('pointerdown', e => {
                if (hudMoveMode) {
                    e.preventDefault();
                    gameEl.setPointerCapture?.(e.pointerId);
                    moveHudTo(e, hudMoveMode)
                }
            }
            );
            gameEl.addEventListener('pointermove', e => {
                if (hudMoveMode) {
                    e.preventDefault();
                    moveHudTo(e, hudMoveMode)
                }
            }
            );
            gameEl.addEventListener('pointerup', e => {
                if (hudMoveMode) {
                    e.preventDefault();
                    stopHudMove();
                    saveGameHud()
                }
            }
            );
            gameEl.addEventListener('pointercancel', e => {
                if (hudMoveMode) {
                    e.preventDefault();
                    stopHudMove();
                    saveGameHud()
                }
            }
            );
            setupJoy();
        }
        function setupJoy() {
            const j = $('joy')
              , kn = j.querySelector('.knob');
            j.style.touchAction = 'none';
            kn.style.willChange = 'transform';
            kn.style.transition = 'none';
            let pid = null;
            const DEAD = .018
              , MAX = .40;
            function resetJoy() {
                pid = null;
                kn.style.transform = 'translate(-50%,-50%) scale(' + +$('stickSize').value + ')';
                if (engine) {
                    engine.touch.x = engine.touch.y = 0;
                    engine.touch.active = false
                }
            }
            function set(e) {
                if (hudMoveMode === 'joy') {
                    moveHudTo(e, 'joy');
                    return
                }
                const r = j.getBoundingClientRect()
                  , cx = r.left + r.width / 2
                  , cy = r.top + r.height / 2;
                let dx = e.clientX - cx
                  , dy = e.clientY - cy
                  , max = r.width * MAX
                  , l = Math.hypot(dx, dy);
                if (l > max) {
                    dx = dx / l * max;
                    dy = dy / l * max;
                    l = max
                }
                const raw = Math.min(1, l / max);
                let power = raw <= DEAD ? 0 : Math.pow((raw - DEAD) / (1 - DEAD), .96);
                const nx = l > .0001 ? dx / l : 0
                  , ny = l > .0001 ? dy / l : 0;
                const outX = nx * power
                  , outY = ny * power;
                kn.style.transform = `translate3d(calc(-50% + ${dx}px),calc(-50% + ${dy}px),0) scale(${$('stickSize').value})`;
                if (engine) {
                    engine.touch.x = outX;
                    engine.touch.y = outY;
                    engine.touch.active = power > 0
                }
            }
            j.addEventListener('pointerdown', e => {
                e.preventDefault();
                pid = e.pointerId;
                try {
                    j.setPointerCapture?.(pid)
                } catch (_) {}
                set(e)
            }
            );
            j.addEventListener('pointermove', e => {
                if (e.pointerId === pid)
                    set(e)
            }
            );
            ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => j.addEventListener(ev, e => {
                if (ev !== 'lostpointercapture' && e.pointerId !== pid)
                    return;
                if (hudMoveMode === 'joy') {
                    pid = null;
                    stopHudMove();
                    saveGameHud();
                    resetJoy();
                    return
                }
                resetJoy()
            }
            ));
            addEventListener('pointerup', e => {
                if (pid === e.pointerId)
                    resetJoy()
            }
            , {
                passive: true
            });
            addEventListener('pointercancel', e => {
                if (pid === e.pointerId)
                    resetJoy()
            }
            , {
                passive: true
            });
            addEventListener('blur', resetJoy);
            document.addEventListener('visibilitychange', () => {
                if (document.hidden)
                    resetJoy()
            }
            )
        }

        function inputFor(p) {
            if (spectatorMode)
                return {
                    x: 0,
                    y: 0,
                    l: 0
                };
            let x = 0
              , y = 0;
            if (engine.keys.has(keyBindings.left))
                x--;
            if (engine.keys.has(keyBindings.right))
                x++;
            if (engine.keys.has(keyBindings.up))
                y--;
            if (engine.keys.has(keyBindings.down))
                y++;
            if (engine.touch.active) {
                x = engine.touch.x;
                y = engine.touch.y
            }
            let l = Math.hypot(x, y);
            return l > .001 ? {
                x: x / l,
                y: y / l,
                l
            } : {
                x: 0,
                y: 0,
                l: 0
            }
        }
        function impulse(p, x, y, amount) {
            p.vx += x * amount / p.mass;
            p.vy += y * amount / p.mass
        }
        function kickBall(ball, dx, dy, dt, pp, bp, mult=1) {
            const d = Math.hypot(dx, dy) || 1;
            impulse(ball, dx / d, dy / d, (pp.impulseWithKick * 2.62 * dt * 60 + bp.ballPower * 40.0) * mult)
        }
        function collide(a, b, rest) {
            let dx = b.x - a.x
              , dy = b.y - a.y
              , d = Math.hypot(dx, dy) || .0001
              , min = a.r + b.r;
            if (d >= min)
                return;
            let nx = dx / d
              , ny = dy / d
              , pen = min - d;
            a.x -= nx * pen * (b.mass / (a.mass + b.mass));
            a.y -= ny * pen * (b.mass / (a.mass + b.mass));
            b.x += nx * pen * (a.mass / (a.mass + b.mass));
            b.y += ny * pen * (a.mass / (a.mass + b.mass));
            let rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
            if (rv > 0)
                return;
            let j = -(1 + rest) * rv / (1 / a.mass + 1 / b.mass);
            a.vx -= j * nx / a.mass;
            a.vy -= j * ny / a.mass;
            b.vx += j * nx / b.mass;
            b.vy += j * ny / b.mass
        }
        function collideStaticCircle(b, cx, cy, cr, rest) {
            let dx = b.x - cx
              , dy = b.y - cy
              , d = Math.hypot(dx, dy) || .0001
              , min = b.r + cr;
            if (d >= min)
                return false;
            let nx = dx / d
              , ny = dy / d;
            b.x = cx + nx * min;
            b.y = cy + ny * min;
            let vn = b.vx * nx + b.vy * ny;
            if (vn < 0) {
                b.vx -= (1 + rest) * vn * nx;
                b.vy -= (1 + rest) * vn * ny;
            }
            return true
        }
        /* ===== TRAVES E REDES COM FÍSICA =====
           Cada gol tem: 2 postes (colisão circular), laterais e fundo de rede (a bola quica pouco e é
           freada), e uma rede de teto simulada como membrana elástica (onda + mola + amortecimento)
           que "estufa" quando a bola/jogador passa por baixo e balança depois. */
        const NET_NX = 12, NET_NY = 22;
        function ensureNets(e) {
            if (e.nets && e.netsFor === e.m)
                return e.nets;
            const gs = e.m.GoalProperty.GoalSettings;
            e.netsFor = e.m;
            e.sparks = [];
            e.nets = e.m.GoalProperty.GoalLine.map(g => {
                const dir = g.team === 1 ? -1 : 1;
                const sz = (NET_NX + 1) * (NET_NY + 1);
                return {
                    g, dir, x0: g.x1, xb: g.x1 + dir * gs.GoalDept, depth: gs.GoalDept, y1: g.y1, y2: g.y2, pr: gs.PostRadius,
                    z: new Float32Array(sz), v: new Float32Array(sz),
                    back: new Float32Array(NET_NY + 1), backV: new Float32Array(NET_NY + 1),
                    sideA: new Float32Array(NET_NX + 1), sideAV: new Float32Array(NET_NX + 1),
                    sideB: new Float32Array(NET_NX + 1), sideBV: new Float32Array(NET_NX + 1),
                    post: [{ x: g.x1, y: g.y1, amp: 0, t: 9 }, { x: g.x1, y: g.y2, amp: 0, t: 9 }]
                };
            });
            return e.nets;
        }
        // Impacto numa rede vertical (fundo ou lateral): empurra a rede para fora perto do ponto de contato.
        function netImpact(n, kind, along, speed) {
            const k = Math.min(speed, 24) * .06;
            if (kind === 'back') {
                const hy = (n.y2 - n.y1) / NET_NY;
                for (let j = 1; j < NET_NY; j++)
                    n.backV[j] += k * Math.exp(-Math.pow((n.y1 + j * hy - along) / .55, 2) / 2);
            } else {
                const arr = kind === 'a' ? n.sideAV : n.sideBV, hx = n.depth / NET_NX;
                for (let i = 1; i < NET_NX; i++)
                    arr[i] += k * Math.exp(-Math.pow((i * hx - along) / .5, 2) / 2);
            }
        }
        function stepNet1D(off, vel, h, dt) {
            const n = off.length;
            for (let i = 1; i < n - 1; i++) {
                const lap = (off[i - 1] - 2 * off[i] + off[i + 1]) / (h * h);
                vel[i] += (14 * lap - 20 * off[i] - 3.2 * vel[i]) * dt;
            }
            for (let i = 1; i < n - 1; i++)
                off[i] = Math.max(-.05, Math.min(.4, off[i] + vel[i] * dt));
        }
        // Algo (bola/jogador) dentro do gol levanta a rede de teto ao redor dele.
        function pushNetRoof(n, o, hx, hy, isBall) {
            const u = n.dir * (o.x - n.x0);
            if (u <= 0 || o.y < n.y1 || o.y > n.y2 || u > n.depth + o.r)
                return;
            const speed = Math.hypot(o.vx || 0, o.vy || 0);
            const amp = (isBall ? .08 + Math.min(.2, speed * .012) : .06) * Math.min(1, u / o.r);
            const sg = o.r * 1.15, W = NET_NY + 1;
            const i0 = Math.max(1, Math.floor((u - 3 * sg) / hx)), i1 = Math.min(NET_NX - 1, Math.ceil((u + 3 * sg) / hx));
            const j0 = Math.max(1, Math.floor((o.y - 3 * sg - n.y1) / hy)), j1 = Math.min(NET_NY - 1, Math.ceil((o.y + 3 * sg - n.y1) / hy));
            for (let i = i0; i <= i1; i++)
                for (let j = j0; j <= j1; j++) {
                    const dx = i * hx - u, dy = n.y1 + j * hy - o.y;
                    const t = amp * Math.exp(-(dx * dx + dy * dy) / (2 * sg * sg));
                    const k = i * W + j;
                    if (n.z[k] < t) {
                        n.z[k] = t;
                        if (n.v[k] < 0)
                            n.v[k] = 0;
                    }
                }
        }
        function updateGoalNets(dt) {
            const e = engine;
            if (!e || !e.m)
                return;
            const nets = ensureNets(e);
            const steps = Math.max(1, Math.min(4, Math.ceil(dt / .012))), h = dt / steps, W = NET_NY + 1;
            for (const n of nets) {
                const hx = n.depth / NET_NX, hy = (n.y2 - n.y1) / NET_NY;
                for (let s = 0; s < steps; s++) {
                    for (let i = 1; i < NET_NX; i++)
                        for (let j = 1; j < NET_NY; j++) {
                            const k = i * W + j, z = n.z[k];
                            const lap = (n.z[k - W] - 2 * z + n.z[k + W]) / (hx * hx) + (n.z[k - 1] - 2 * z + n.z[k + 1]) / (hy * hy);
                            n.v[k] += (9 * lap - 14 * z - 2.4 * n.v[k]) * h;
                        }
                    for (let i = 1; i < NET_NX; i++)
                        for (let j = 1; j < NET_NY; j++) {
                            const k = i * W + j;
                            n.z[k] = Math.max(-.12, Math.min(.35, n.z[k] + n.v[k] * h));
                        }
                    stepNet1D(n.back, n.backV, hy, h);
                    stepNet1D(n.sideA, n.sideAV, hx, h);
                    stepNet1D(n.sideB, n.sideBV, hx, h);
                    pushNetRoof(n, e.ball, hx, hy, true);
                    for (const q of e.players)
                        if (q.x > -50)
                            pushNetRoof(n, q, hx, hy, false);
                }
                for (const pt of n.post) {
                    pt.amp *= Math.exp(-4.2 * dt);
                    pt.t += dt;
                }
            }
            for (let i = e.sparks.length - 1; i >= 0; i--) {
                const sp = e.sparks[i];
                sp.life -= dt;
                if (sp.life <= 0) {
                    e.sparks.splice(i, 1);
                    continue;
                }
                sp.x += sp.vx * dt;
                sp.y += sp.vy * dt;
                sp.vx *= Math.exp(-3 * dt);
                sp.vy *= Math.exp(-3 * dt);
            }
        }
        function postHitFx(e, n, pt, b, speed) {
            pt.amp = Math.min(1, speed / 16);
            pt.t = 0;
            let nx = b.x - pt.x, ny = b.y - pt.y;
            const d = Math.hypot(nx, ny) || 1;
            nx /= d;
            ny /= d;
            const cx = pt.x + nx * n.pr, cy = pt.y + ny * n.pr;
            const count = Math.min(10, 3 + Math.round(speed * .4));
            for (let i = 0; i < count; i++) {
                const a = Math.atan2(ny, nx) + (Math.random() - .5) * 2.2, v = 1.5 + Math.random() * (1 + speed * .25);
                e.sparks.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: .25 + Math.random() * .25, max: .5 });
            }
        }
        // Bola dentro do gol: laterais e fundo seguram a bola (quica pouco) e a rede freia (arrasto).
        function goalNetPhysics(dt) {
            const e = engine, b = e.ball;
            for (const n of ensureNets(e)) {
                const u = n.dir * (b.x - n.x0);
                if (u <= 0 || b.y < n.y1 - b.r || b.y > n.y2 + b.r)
                    continue;
                const drag = Math.exp(-2.8 * dt);
                b.vx *= drag;
                b.vy *= drag;
                if (b.y - b.r < n.y1) {
                    b.y = n.y1 + b.r;
                    if (b.vy < 0) {
                        netImpact(n, 'a', u, -b.vy);
                        b.vy = -b.vy * .22;
                    }
                }
                if (b.y + b.r > n.y2) {
                    b.y = n.y2 - b.r;
                    if (b.vy > 0) {
                        netImpact(n, 'b', u, b.vy);
                        b.vy = -b.vy * .22;
                    }
                }
                if (u + b.r > n.depth) {
                    b.x = n.x0 + n.dir * (n.depth - b.r);
                    const vn = n.dir * b.vx;
                    if (vn > 0) {
                        netImpact(n, 'back', b.y, vn);
                        b.vx = -n.dir * vn * .16;
                    }
                }
            }
        }
        // Depois do gol a partida pausa, mas a bola continua rolando e morrendo dentro da rede.
        function goalAftermath(dt) {
            const e = engine;
            if (!e || !e.ball || !e.m)
                return;
            const b = e.ball, bd = Math.max(0, 1 - e.m.BallProperty.damping * dt);
            b.vx *= bd;
            b.vy *= bd;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            goalNetPhysics(dt);
        }
        /* ===== SEÇÃO 10 - FÍSICA, IA E REGRAS DE GOL ===== */
        function physics(dt) {
            const e = engine
              , m = e.m
              , pp = m.PlayerProperty
              , bp = m.BallProperty
              , p = e.players[0]
              , bot = e.players[1]
              , b = e.ball;
            e.kickFlash = Math.max(0, e.kickFlash - dt);
            e.passFlash = Math.max(0, (e.passFlash || 0) - dt);
            e.postSoundCd = Math.max(0, (e.postSoundCd || 0) - dt);
            let inp = inputFor(p);
            if (spectatorMode) {
                p.vx = 0;
                p.vy = 0
            } else if (inp.l > .05) {
                const moveSpeed = 4.9;
                p.vx = inp.x * moveSpeed;
                p.vy = inp.y * moveSpeed
            } else {
                p.vx = 0;
                p.vy = 0;
            }
            if (mode === 'ai') {
                const attackGoal = m.GoalProperty.GoalLine.find(g => g.team === 1);
                const gx = attackGoal ? attackGoal.x1 : m.BallAreaSettings.Line[0].x1;
                const gy = attackGoal ? (attackGoal.y1 + attackGoal.y2) / 2 : (m.BallAreaSettings.Line[0].y1 + m.BallAreaSettings.Line[1].y1) / 2;
                let ax = b.x
                  , ay = b.y;
                const gl = Math.hypot(gx - b.x, gy - b.y) || 1;
                const ux = (gx - b.x) / gl
                  , uy = (gy - b.y) / gl;
                const behindGap = bot.r + b.r + .16;
                ax = b.x - ux * behindGap;
                ay = b.y - uy * behindGap;
                const adx = ax - bot.x
                  , ady = ay - bot.y
                  , ad = Math.hypot(adx, ady);
                const aiSpeed = 4.9;
                if (ad > .08) {
                    bot.vx = adx / ad * aiSpeed;
                    bot.vy = ady / ad * aiSpeed
                } else {
                    bot.vx = 0;
                    bot.vy = 0;
                }
            } else {
                bot.vx = 0;
                bot.vy = 0;
                bot.x = -100;
                bot.y = -100;
            }
            let damp = Math.max(0, 1 - pp.damping * dt)
              , bd = Math.max(0, 1 - bp.damping * dt);
            p.vx *= damp;
            p.vy *= damp;
            bot.vx *= damp;
            bot.vy *= damp;
            b.vx *= bd;
            b.vy *= bd;
            const max = 6.35;
            for (const q of e.players) {
                let s = Math.hypot(q.vx, q.vy);
                if (s > max) {
                    q.vx = q.vx / s * max;
                    q.vy = q.vy / s * max
                }
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            bot.x += bot.vx * dt;
            bot.y += bot.vy * dt;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.angle = 0;
            for (const q of e.players) {
                q.x = Math.max(q.r, Math.min(m.PlayerAreaSettings.width - q.r, q.x));
                q.y = Math.max(q.r, Math.min(m.PlayerAreaSettings.height - q.r, q.y))
            }
            const bx0 = m.BallAreaSettings.Line[0].x1
              , bx1 = m.BallAreaSettings.Line[0].x2
              , by0 = m.BallAreaSettings.Line[0].y1
              , by1 = m.BallAreaSettings.Line[1].y1;
            let goals = m.GoalProperty.GoalLine;
            let left = goals.filter(g => g.team === 1)
              , right = goals.filter(g => g.team === 2);
            const inGoal = (y, gs) => {
                const g = gs.find(v => v.y1 === 2.1 && v.y2 === 3.4) || gs[0];
                if (!g)
                    return false;
                const postR = m.GoalProperty.GoalSettings.PostRadius;
                const goalOpeningTop = g.y1 + postR
                  , goalOpeningBottom = g.y2 - postR;
                return y >= goalOpeningTop && y <= goalOpeningBottom
            }
            ;
            const goalDepth = m.GoalProperty.GoalSettings.GoalDept;
            const wallRest = .55;
            const realRules = m.style === 'real'; // Real Soccer: sem paredes, a bola sai e há reposição
            const clampBallWalls = () => {
                if (realRules)
                    return;
                if (b.y - b.r < by0) {
                    b.y = by0 + b.r;
                    b.vy = Math.abs(b.vy) * wallRest
                }
                if (b.y + b.r > by1) {
                    b.y = by1 - b.r;
                    b.vy = -Math.abs(b.vy) * wallRest
                }
                const lgw = inGoal(b.y, left)
                  , rgw = inGoal(b.y, right);
                if (b.x - b.r < bx0 && !lgw) {
                    b.x = bx0 + b.r;
                    b.vx = Math.abs(b.vx) * wallRest
                }
                if (b.x + b.r > bx1 && !rgw) {
                    b.x = bx1 - b.r;
                    b.vx = -Math.abs(b.vx) * wallRest
                }
            }
            ;
            // Depois de um jogador empurrar a bola contra a parede: reaplica a parede e afasta o jogador,
            // para a bola nunca ficar fora da quadra nem "atravessar e voltar".
            const fixBallAgainstWall = q => {
                if (realRules)
                    return;
                clampBallWalls();
                const ddx = b.x - q.x
                  , ddy = b.y - q.y
                  , dd = Math.hypot(ddx, ddy) || .0001
                  , need = q.r + b.r;
                if (dd < need) {
                    const pen = need - dd;
                    q.x -= ddx / dd * pen;
                    q.y -= ddy / dd * pen;
                    q.x = Math.max(q.r, Math.min(m.PlayerAreaSettings.width - q.r, q.x));
                    q.y = Math.max(q.r, Math.min(m.PlayerAreaSettings.height - q.r, q.y))
                }
            }
            ;
            clampBallWalls();
            let lg = inGoal(b.y, left)
              , rg = inGoal(b.y, right);
            const leftBack = left[0] ? left[0].x1 - goalDepth : bx0
              , rightBack = right[0] ? right[0].x1 + goalDepth : bx1;
            // barreira invisível no fundo das redes: a bola entra no gol, mas não atravessa a trave de fundo

            // barreira invisível também limita jogadores dentro da profundidade da rede
            for (const q of e.players) {
                if (q === bot && mode !== 'ai')
                    continue;
                if (q.y >= left[0]?.y1 && q.y <= left[0]?.y2 && q.x < left[0].x1 && q.x - q.r < leftBack)
                    q.x = leftBack + q.r;
                if (q.y >= right[0]?.y1 && q.y <= right[0]?.y2 && q.x > right[0].x1 && q.x + q.r > rightBack)
                    q.x = rightBack - q.r
            }
            if (!e.goalAnim && lg && b.x + b.r < left[0].x1) {
                e.blue++;
                startGoalSequence('blue')
            }
            if (!e.goalAnim && rg && b.x - b.r > right[0].x1) {
                e.red++;
                startGoalSequence('red')
            }
            const postRest = Math.min(.88, Math.max(.8, bp.restitution + .08));
            const nets = ensureNets(e);
            for (const n of nets)
                for (const pt of n.post) {
                    const sp = Math.hypot(b.vx, b.vy);
                    if (collideStaticCircle(b, pt.x, pt.y, n.pr, postRest)) {
                        postHitFx(e, n, pt, b, sp);
                        if (e.postSoundCd <= 0) {
                            playPostCue(sp);
                            e.postSoundCd = .16
                        }
                    }
                }
            goalNetPhysics(dt);
            // jogadores também esbarram nas traves e não atravessam as laterais/fundo da rede
            for (const q of e.players) {
                if (q.x < -50 || (q === bot && mode !== 'ai'))
                    continue;
                for (const n of nets) {
                    for (const pt of n.post)
                        collideStaticCircle(q, pt.x, pt.y, n.pr, .15);
                    const u = n.dir * (q.x - n.x0);
                    if (u > q.r * .9 && q.y > n.y1 && q.y < n.y2) {
                        q.y = Math.max(n.y1 + q.r, Math.min(n.y2 - q.r, q.y));
                        if (u + q.r > n.depth) {
                            q.x = n.x0 + n.dir * (n.depth - q.r);
                            if (n.dir * q.vx > 0)
                                q.vx = 0;
                        }
                    }
                }
            }
            collide(p, b, (pp.restitution + bp.restitution) / 2);
            fixBallAgainstWall(p);
            if (mode === 'ai') {
                collide(bot, b, (pp.restitution + bp.restitution) / 2);
                fixBallAgainstWall(bot);
                e.botKickCd = Math.max(0, (e.botKickCd || 0) - dt);
                const enemyGoal = goals.find(g => g.team === 1);
                const postR = m.GoalProperty.GoalSettings.PostRadius;
                const aimTop = enemyGoal ? enemyGoal.y1 + postR : (by0 + by1) / 2;
                const aimBottom = enemyGoal ? enemyGoal.y2 - postR : (by0 + by1) / 2;
                const aimYTarget = (aimTop + aimBottom) / 2;
                const aimXTarget = enemyGoal ? enemyGoal.x1 : bx0;
                const aimX = aimXTarget - b.x
                  , aimY = aimYTarget - b.y
                  , aimLen = Math.hypot(aimX, aimY) || 1;
                const dirX = aimX / aimLen
                  , dirY = aimY / aimLen;
                bot.aimX = aimXTarget;
                bot.aimY = aimYTarget;
                bot.aimDX = dirX;
                bot.aimDY = dirY;
                const bd = Math.hypot(b.x - bot.x, b.y - bot.y);
                const behind = ((bot.x - b.x) * dirX + (bot.y - b.y) * dirY) < -.08;
                if (bd < bot.r + b.r + .52 && behind && e.botKickCd <= 0) {
                    const shotSpeed = Math.max(4.3, Math.hypot(b.vx, b.vy));
                    b.vx = bot.aimDX * shotSpeed;
                    b.vy = bot.aimDY * shotSpeed;
                    play('sound/kick_ball.mp3');
                    e.botKickCd = .82;
                }
            } else {
                bot.x = -100;
                bot.y = -100;
            }
            collide(p, bot, pp.restitution);
            e.kickBuffer = Math.max(0, e.kickBuffer - dt);
            e.passBuffer = Math.max(0, e.passBuffer - dt);
            /* Trava só entre tipos diferentes: logo após um chute ignora o passe (e vice-versa),
               para não somar os dois impulsos. Repetir o MESMO botão continua sem limite extra. */
            e.actionLock = Math.max(0, (e.actionLock || 0) - dt);
            if (e.actionLock > 0) {
                if (e.lastAction === 'kick')
                    e.passBuffer = 0;
                else
                    e.kickBuffer = 0;
            }
            /* CORREÇÃO DO BUG: antes, passe e chute eram dois "if" independentes e, se as
               duas teclas estivessem ativas no mesmo quadro, os dois impulsos (passe 1.48 +
               chute 2.05) eram aplicados na mesma bola e se somavam, gerando um chute
               absurdamente forte. Agora apenas UMA ação é aplicada por quadro: o chute tem
               prioridade e, quando dispara, o buffer de passe é zerado para não acumular. */
            if (!spectatorMode && (e.kickBuffer > 0 || e.passBuffer > 0)) {
                let dx = b.x - p.x
                  , dy = b.y - p.y
                  , d = Math.hypot(dx, dy) || 1;
                if (d < p.r + b.r + .18) {
                    if (e.kickBuffer > 0) {
                        // Chute tem prioridade sobre o passe.
                        kickBall(b, dx, dy, dt, pp, bp, 2.05);
                        e.kickFlash = .22;
                        e.lastAction = 'kick';
                    } else {
                        kickBall(b, dx, dy, dt, pp, bp, 1.48);
                        e.passFlash = .22;
                        e.lastAction = 'pass';
                    }
                    // Zera os dois buffers: impede que o segundo impulso seja somado no mesmo contato.
                    e.kickBuffer = 0;
                    e.passBuffer = 0;
                    e.actionLock = .15;
                    play('sound/kick_ball.mp3')
                }
            }
            if (realRules && !e.goalAnim)
                realSoccerRules(dt, lg, rg, left, right, bx0, bx1, by0, by1);
            if (!e.goalAnim && (e.red >= roomConfig.scoreLimit || e.blue >= roomConfig.scoreLimit || e.time <= 0)) {
                e.running = false;
                scheduleMatchFinish(e);
            }
        }
        /* ===== REAL SOCCER: lateral, escanteio e tiro de meta (sem falta e sem impedimento) =====
           - Bola toda fora da linha lateral  -> lateral para quem NÃO tocou por último.
           - Bola toda fora da linha de fundo (fora do gol):
               tocou por último o time que defende -> escanteio para o atacante;
               tocou por último o atacante         -> tiro de meta para o defensor.
           A bola fica parada no ponto da reposição até um jogador do time que cobra encostar nela;
           o adversário é afastado da bola. Se o time que cobra não tem ninguém (só você na sala),
           a bola é reposta sozinha após 1,5 s. */
        function realSoccerRules(dt, lg, rg, left, right, bx0, bx1, by0, by1) {
            const e = engine, b = e.ball, m = e.m;
            const p = e.players[0];
            const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, w = bx1 - bx0;
            const other = t => t === 'red' ? 'blue' : 'red';
            const touchRange = p ? p.r + b.r + .2 : 0;
            if (p && !spectatorMode && Math.hypot(b.x - p.x, b.y - p.y) <= touchRange)
                e.lastTouch = p.team;
            const r = e.restart;
            if (r) {
                const takerIsMe = p && !spectatorMode && p.team === r.team;
                if (takerIsMe && Math.hypot(b.x - p.x, b.y - p.y) <= p.r + b.r + .12) {
                    e.restart = null;            // cobrou: jogo segue (a bola mantém o impulso do toque)
                    e.lastTouch = p.team;
                    return;
                }
                r.t += dt;
                if (!takerIsMe && r.t >= 1.5) {  // time sem jogador cobra sozinho, em direção ao meio
                    const dx = cx - b.x, dy = cy - b.y, d = Math.hypot(dx, dy) || 1;
                    const sp = r.type === 'goalkick' ? 9 : 7;
                    b.vx = dx / d * sp;
                    b.vy = dy / d * sp;
                    e.lastTouch = r.team;
                    e.restart = null;
                    play('sound/kick_ball.mp3');
                    return;
                }
                b.x = r.x;
                b.y = r.y;
                b.vx = b.vy = 0;
                if (p && !takerIsMe && !spectatorMode) {
                    const R = 4, dx = p.x - r.x, dy = p.y - r.y, d = Math.hypot(dx, dy) || .001;
                    if (d < R) {
                        p.x = r.x + dx / d * R;
                        p.y = r.y + dy / d * R;
                        p.x = Math.max(p.r, Math.min(m.PlayerAreaSettings.width - p.r, p.x));
                        p.y = Math.max(p.r, Math.min(m.PlayerAreaSettings.height - p.r, p.y));
                    }
                }
                return;
            }
            const last = e.lastTouch || (p ? p.team : 'red');
            const startRestart = (type, team, x, y) => {
                e.restart = { type, team, x, y, t: 0 };
                b.x = x;
                b.y = y;
                b.vx = b.vy = 0;
                e.lastTouch = null;
            };
            const goalDepth = w * (5.5 / 105);
            const outLeft = b.x + b.r < bx0 && !lg;
            const outRight = b.x - b.r > bx1 && !rg;
            if (outLeft || outRight) {
                const defender = outLeft ? 'red' : 'blue';    // vermelho defende o gol da esquerda
                const attacker = other(defender);
                if (last === defender) {                      // escanteio
                    startRestart('corner', attacker, outLeft ? bx0 + .2 : bx1 - .2, b.y < cy ? by0 + .2 : by1 - .2);
                } else {                                      // tiro de meta
                    startRestart('goalkick', defender, outLeft ? bx0 + goalDepth * .8 : bx1 - goalDepth * .8, cy);
                }
            } else if (b.y + b.r < by0 || b.y - b.r > by1) { // lateral
                const top = b.y < cy;
                startRestart('throw', other(last), Math.max(bx0 + .6, Math.min(bx1 - .6, b.x)), top ? by0 : by1);
            }
        }
        function reset() {
            const m = engine.m;
            const bx0 = m.BallAreaSettings.Line[0].x1
              , bx1 = m.BallAreaSettings.Line[0].x2;
            const spawnX = bx0 + 1.35;
            const playerIsBlue = roomRole === 'blue';
            engine.players[0].team = playerIsBlue ? 'blue' : 'red';
            engine.players[0].x = playerIsBlue ? bx1 - 1.35 : spawnX;
            engine.players[0].y = (m.BallAreaSettings.Line[0].y1 + m.BallAreaSettings.Line[1].y1) / 2;
            engine.players[1].x = playerIsBlue ? spawnX : bx1 - 1.35;
            engine.players[1].y = engine.players[0].y;
            for (const p of engine.players)
                p.vx = p.vy = 0;
            engine.ball.x = (bx0 + bx1) / 2;
            engine.ball.y = engine.players[0].y;
            engine.ball.vx = engine.ball.vy = 0;
            engine.ball.angle = 0;
            engine.restart = null;
            engine.lastTouch = null
        }
        function startGoalSequence(team) {
            const e = engine;
            const scorer = e.players.find(player => player.team === team);
            e.goalAnim = {
                team,
                scorerName: scorer?.nick || (team === roomRole ? state.nick : team === 'red' ? 'Time vermelho' : 'Time azul'),
                fx: scorer && scorer === e.players[0] ? (FH_EXCL.owns(FH_EXCL.equipped('fx')) ? FH_EXCL.equipped('fx') : null) : (scorer && scorer.fx) || null,
                t: 0
            };
            e.goalPause = 2.35;
            e.running = true;
            for (const p of e.players)
                p.vx = p.vy = 0
        }
        function getRenderDPR() {
            const d = window.devicePixelRatio || 1;
            return Math.min(2, Math.max(.6, Math.min(2, Math.max(1, d)) * graphicsSettings.renderScale / 100))
        }
        /* ===== SEÇÃO 11 - TELA E SONS PONTUAIS ===== */
        function resize() {
            if (!engine)
                return;
            const dpr = getRenderDPR();
            engine.renderDPR = dpr;
            engine.c.width = Math.ceil(innerWidth * dpr);
            engine.c.height = Math.ceil(innerHeight * dpr);
            engine.c.style.width = '100%';
            engine.c.style.height = '100%'
        }
        addEventListener('resize', resize);
        async function getAudioMetrics(context, source) {
            const response = await fetch(source);
            if (!response.ok)
                throw new Error('Não foi possível carregar um dos áudios para comparação.');
            const buffer = await context.decodeAudioData(await response.arrayBuffer());
            let sumSquares = 0;
            let peak = 0;
            let sampleCount = 0;
            for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex++) {
                const channel = buffer.getChannelData(channelIndex);
                for (let i = 0; i < channel.length; i++) {
                    const magnitude = Math.abs(channel[i]);
                    sumSquares += channel[i] * channel[i];
                    peak = Math.max(peak, magnitude);
                    sampleCount++
                }
            }
            const rms = Math.sqrt(sumSquares / sampleCount);
            if (!rms || !peak || !buffer.duration)
                throw new Error('O áudio está vazio ou não pode ser analisado.');
            return { duration: buffer.duration, rms, peak }
        }
        async function calculateBallSoundFit(source) {
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass)
                throw new Error('Este navegador não permite analisar áudio para ajuste automático.');
            const context = new AudioContextClass();
            try {
                const [custom, original] = await Promise.all([
                    getAudioMetrics(context, source),
                    getAudioMetrics(context, img('sound/kick_ball.mp3'))
                ]);
                if (custom.duration > 10)
                    throw new Error('O áudio deve ter no máximo 10 segundos.');
                const targetRate = Math.max(.5, Math.min(2, custom.duration / original.duration));
                const rmsVolume = .35 * original.rms / custom.rms;
                const peakVolume = .35 * original.peak / custom.peak;
                const volume = Math.max(.01, Math.min(1, rmsVolume, peakVolume));
                return { volume, playbackRate: targetRate }
            } finally {
                await context.close()
            }
        }
        /* Presets de som de bola: sintetizados (sem arquivos extras). */
        const KICK_PRESETS = {
            seco:    { label: 'Chute seco',     body: [170, 60, .09, 'sine', .9],     noise: [1800, .03, .35] },
            grave:   { label: 'Chute grave',    body: [110, 38, .22, 'sine', 1.0],    noise: [500, .05, .25] },
            estalo:  { label: 'Estalo',         body: [320, 120, .06, 'triangle', .6], noise: [4200, .05, .7] },
            praia:   { label: 'Bola de praia',  body: [240, 150, .16, 'sine', .55],   noise: [900, .07, .12] },
            basquete:{ label: 'Quicar (basquete)', body: [140, 80, .13, 'sine', .95], noise: [2600, .02, .3], echo: .09 },
            retro:   { label: 'Retrô 8-bit',    body: [880, 220, .11, 'square', .35], noise: null },
            bolha:   { label: 'Bolha (pop)',    body: [260, 900, .08, 'sine', .6],    noise: null }
        };
        let ballPresetCtx = null;
        function playBallPreset(name) {
            const p = KICK_PRESETS[name];
            if (!p)
                return;
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!AC)
                    return;
                if (!ballPresetCtx)
                    ballPresetCtx = new AC();
                const ac = ballPresetCtx;
                ac.resume();
                const strike = (t0, amp) => {
                    const mv = Math.max(.0002, amp * masterVolume * ballVolume * .6);
                    const [f0,f1,dur,type,lv] = p.body;
                    const o = ac.createOscillator()
                      , g = ac.createGain();
                    o.type = type;
                    o.frequency.setValueAtTime(f0, t0);
                    o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
                    g.gain.setValueAtTime(.0001, t0);
                    g.gain.exponentialRampToValueAtTime(Math.max(.0002, lv * mv), t0 + .006);
                    g.gain.exponentialRampToValueAtTime(.0001, t0 + dur + .04);
                    o.connect(g).connect(ac.destination);
                    o.start(t0);
                    o.stop(t0 + dur + .06);
                    if (p.noise) {
                        const [nf,nd,nl] = p.noise;
                        const n = Math.max(1, Math.floor(ac.sampleRate * nd))
                          , buf = ac.createBuffer(1, n, ac.sampleRate)
                          , d = buf.getChannelData(0);
                        for (let i = 0; i < n; i++)
                            d[i] = (Math.random() * 2 - 1) * (1 - i / n);
                        const s = ac.createBufferSource()
                          , f = ac.createBiquadFilter()
                          , ng = ac.createGain();
                        s.buffer = buf;
                        f.type = 'bandpass';
                        f.frequency.value = nf;
                        f.Q.value = .8;
                        ng.gain.value = Math.max(.0002, nl * mv);
                        s.connect(f).connect(ng).connect(ac.destination);
                        s.start(t0)
                    }
                };
                strike(ac.currentTime, 1);
                if (p.echo)
                    strike(ac.currentTime + p.echo, .35)
            } catch (err) {
                console.warn('Preset de som da bola indisponível:', err)
            }
        }
        function applyMasterVolume(v) {
            masterVolume = Math.max(0, Math.min(1, v));
            try { localStorage.setItem('fh_master_volume', String(masterVolume)); } catch (e) {}
            configureCrowd()
        }
        function play(k, preview=false, vol) {
            if (!preview && state.settings.sound === 'off')
                return;
            try {
                const catVol = k === 'sound/whistle_01.mp3' ? goalVolume : ballVolume;
                const useCustomBallSound = k === 'sound/kick_ball.mp3' && customBallSoundSource;
                if (k === 'sound/kick_ball.mp3' && !useCustomBallSound && ballSoundPreset !== 'original' && KICK_PRESETS[ballSoundPreset]) {
                    playBallPreset(ballSoundPreset);
                    return
                }
                const a = new Audio(useCustomBallSound ? customBallSoundSource : img(k));
                a.volume = Math.max(0, Math.min(1, (useCustomBallSound ? customBallSoundFit.volume : (vol != null ? vol : .35)) * masterVolume * catVol));
                if (useCustomBallSound)
                    a.playbackRate = customBallSoundFit.playbackRate;
                a.play().catch(error => console.warn('Não foi possível reproduzir o efeito sonoro:', error))
            } catch (error) {
                console.warn('Não foi possível iniciar o efeito sonoro:', error)
            }
        }

        function playRoomDing() {
            try {
                const ac = new (window.AudioContext || window.webkitAudioContext)();
                const g = ac.createGain();
                g.gain.setValueAtTime(.0001, ac.currentTime);
                g.gain.exponentialRampToValueAtTime(Math.max(.0002, .08 * masterVolume), ac.currentTime + .012);
                g.gain.exponentialRampToValueAtTime(.0001, ac.currentTime + .34);
                g.connect(ac.destination);
                [660, 880].forEach( (f, i) => {
                    const o = ac.createOscillator();
                    o.type = 'sine';
                    o.frequency.value = f;
                    o.connect(g);
                    o.start(ac.currentTime + i * .07);
                    o.stop(ac.currentTime + .22 + i * .07)
                }
                );
                setTimeout( () => ac.close(), 650)
            } catch {}
        }
        function playGoalCue() {
            try {
                play('sound/whistle_01.mp3')
            } catch {}
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!window.__goWhistleCtx)
                    window.__goWhistleCtx = new AC();
                const ac = window.__goWhistleCtx;
                ac.resume();
                const t = ac.currentTime;
                for (const [freq,delay,dur] of [[1850, 0, .48], [2350, .035, .40]]) {
                    const o = ac.createOscillator()
                      , g = ac.createGain()
                      , f = ac.createBiquadFilter();
                    o.type = 'sine';
                    o.frequency.setValueAtTime(freq, t + delay);
                    o.frequency.exponentialRampToValueAtTime(freq * .88, t + delay + dur);
                    f.type = 'highpass';
                    f.frequency.value = 900;
                    g.gain.setValueAtTime(.0001, t + delay);
                    g.gain.exponentialRampToValueAtTime(Math.max(.0002, .72 * masterVolume * goalVolume), t + delay + .018);
                    g.gain.setValueAtTime(Math.max(.0002, .72 * masterVolume * goalVolume), t + delay + dur * .55);
                    g.gain.exponentialRampToValueAtTime(.0001, t + delay + dur);
                    o.connect(f).connect(g).connect(ac.destination);
                    o.start(t + delay);
                    o.stop(t + delay + dur + .02)
                }
            } catch (err) {
                console.warn('Apito indisponível:', err)
            }
        }
        // Explosão (efeito de gol exclusivo): estrondo de ruído filtrado + pancada grave.
        function playBoom(level) {
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!window.__goWhistleCtx)
                    window.__goWhistleCtx = new AC();
                const ac = window.__goWhistleCtx;
                ac.resume();
                const t = ac.currentTime, vol = Math.max(.0002, .9 * (level || 1) * masterVolume * goalVolume);
                const len = Math.floor(ac.sampleRate * 1.1), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
                for (let i = 0; i < len; i++)
                    d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
                const n = ac.createBufferSource(), lp = ac.createBiquadFilter(), g = ac.createGain();
                n.buffer = buf;
                lp.type = 'lowpass';
                lp.frequency.setValueAtTime(2600, t);
                lp.frequency.exponentialRampToValueAtTime(180, t + .9);
                g.gain.setValueAtTime(vol, t);
                g.gain.exponentialRampToValueAtTime(.0001, t + 1.05);
                n.connect(lp).connect(g).connect(ac.destination);
                n.start(t);
                const o = ac.createOscillator(), og = ac.createGain();
                o.type = 'sine';
                o.frequency.setValueAtTime(110, t);
                o.frequency.exponentialRampToValueAtTime(32, t + .5);
                og.gain.setValueAtTime(vol * .9, t);
                og.gain.exponentialRampToValueAtTime(.0001, t + .6);
                o.connect(og).connect(ac.destination);
                o.start(t);
                o.stop(t + .65)
            } catch (err) {}
        }
        // Sons curtos sintetizados para os outros efeitos de gol (sem arquivos de áudio).
        function goalTone(freqs, o) {
            try {
                const AC = window.AudioContext || window.webkitAudioContext;
                if (!window.__goWhistleCtx)
                    window.__goWhistleCtx = new AC();
                const ac = window.__goWhistleCtx;
                ac.resume();
                const t = ac.currentTime, vol = Math.max(.0002, (o.vol || .35) * masterVolume * goalVolume);
                freqs.forEach((f, i) => {
                    const osc = ac.createOscillator(), g = ac.createGain(), t0 = t + i * (o.gap || .07);
                    osc.type = o.type || 'sine';
                    osc.frequency.setValueAtTime(f, t0);
                    if (o.glide)
                        osc.frequency.exponentialRampToValueAtTime(Math.max(30, f * o.glide), t0 + (o.dur || .25));
                    g.gain.setValueAtTime(.0001, t0);
                    g.gain.exponentialRampToValueAtTime(vol, t0 + .012);
                    g.gain.exponentialRampToValueAtTime(.0001, t0 + (o.dur || .25));
                    osc.connect(g).connect(ac.destination);
                    osc.start(t0);
                    osc.stop(t0 + (o.dur || .25) + .03);
                });
            } catch (err) {}
        }
        function playZap() {
            goalTone([1800, 900, 300], { type: 'sawtooth', glide: .15, dur: .22, gap: .05, vol: .25 });
            playBoom(.45);
        }
        FH_GOALFX.onStart = (g, id) => {
            switch (id) {
            case 'x-raio': playZap(); break;
            case 'x-fogos': playBoom(.6); goalTone([880, 1175, 1568], { type: 'triangle', dur: .35, gap: .18, vol: .22 }); break;
            case 'x-confete': goalTone([784, 988, 1175, 1568], { type: 'triangle', dur: .3, gap: .06, vol: .25 }); break;
            case 'x-moedas': goalTone([1319, 1760, 2093], { type: 'square', dur: .12, gap: .07, vol: .12 }); break;
            case 'x-coracoes': goalTone([523, 659, 784, 1047], { type: 'sine', dur: .4, gap: .09, vol: .28 }); break;
            case 'x-gelo': goalTone([2093, 1568, 2637], { type: 'sine', dur: .45, gap: .09, vol: .22 }); break;
            case 'x-vortice': goalTone([220, 440, 880, 1760], { type: 'sawtooth', glide: 1.6, dur: .55, gap: .08, vol: .16 }); break;
            default: playBoom();
            }
        };
        function playPostCue(speed) {
            // quanto mais forte a bola bate na trave, mais alto o som
            const v = speed == null ? .35 : Math.max(.16, Math.min(.85, .16 + speed * .045));
            play('sound/hit_goal_post_01.mp3', false, v)
        }
        /* ===== SEÇÃO 12 - DESENHO (campo, bola, jogadores, gols, placar) ===== */
        // Seta ao redor do jogador apontando para a bola (some quando a bola está colada nele).
        function drawBallPointer(c, p, b) {
            const dx = b.x - p.x, dy = b.y - p.y;
            const d = Math.hypot(dx, dy);
            const near = p.r + b.r + 1.4, far = near + 1.6;
            if (d <= near)
                return;
            const alpha = Math.min(1, (d - near) / (far - near)) * .9;
            const ux = dx / d, uy = dy / d;
            const px = -uy, py = ux;
            const dist = p.r * 1.62;
            const s = p.r * .3;
            const tipX = p.x + ux * (dist + s * 1.1), tipY = p.y + uy * (dist + s * 1.1);
            const baseX = p.x + ux * dist, baseY = p.y + uy * dist;
            c.save();
            c.globalAlpha = alpha;
            c.beginPath();
            c.moveTo(tipX, tipY);
            c.lineTo(baseX + px * s * .9, baseY + py * s * .9);
            c.lineTo(baseX - ux * s * .25, baseY - uy * s * .25);
            c.lineTo(baseX - px * s * .9, baseY - py * s * .9);
            c.closePath();
            c.fillStyle = '#fff';
            c.strokeStyle = 'rgba(0,0,0,.85)';
            c.lineWidth = Math.max(.02, p.r * .06);
            c.lineJoin = 'round';
            c.fill();
            c.stroke();
            c.restore();
        }
        function drawBallGuide(c, W, H, sx, sy) {
            const margin = Math.max(22, Math.min(W, H) * .055);
            if (sx >= margin && sx <= W - margin && sy >= margin && sy <= H - margin)
                return;
            const cx = W / 2
              , cy = H / 2;
            let dx = sx - cx
              , dy = sy - cy;
            const len = Math.hypot(dx, dy) || 1;
            dx /= len;
            dy /= len;
            let t = Infinity;
            if (dx > 0)
                t = Math.min(t, (W - margin - cx) / dx);
            else if (dx < 0)
                t = Math.min(t, (margin - cx) / dx);
            if (dy > 0)
                t = Math.min(t, (H - margin - cy) / dy);
            else if (dy < 0)
                t = Math.min(t, (margin - cy) / dy);
            const ax = cx + dx * t
              , ay = cy + dy * t;
            const size = Math.max(9, Math.min(W, H) * .022)
              , px = -dy
              , py = dx;
            c.save();
            c.globalAlpha = .95;
            c.fillStyle = '#fff';
            c.beginPath();
            c.moveTo(ax + dx * size * 1.25, ay + dy * size * 1.25);
            c.lineTo(ax - dx * size * .45 + px * size * .72, ay - dy * size * .45 + py * size * .72);
            c.lineTo(ax - dx * size * .45 - px * size * .72, ay - dy * size * .45 - py * size * .72);
            c.closePath();
            c.fill();
            c.restore()
        }

        function drawBall(c, b) {
            if (graphicsSettings.ball3d && window.Ball3D) {
                // Gira a bola conforme ela se move, dando a sensação de rolagem em 3D.
                b.yaw3d = (b.yaw3d || 0) + (b.vx || 0) * .012;
                b.pitch3d = (b.pitch3d || 0) + (b.vy || 0) * .012;
                // Renderiza a esfera na resolução real da tela (nítida), usando o transform atual do mundo.
                // A esfera 3D renderiza com uma leve margem interna e a bola 2D ainda ganha contorno por fora,
                // entao a 3D parecia menor. Compensamos o raio para casar visualmente com a 2D.
                const BALL3D_RADIUS_FIX = 1.1;
                const m = c.getTransform ? c.getTransform() : null;
                if (m) {
                    const sx = m.a * b.x + m.c * b.y + m.e;
                    const sy = m.b * b.x + m.d * b.y + m.f;
                    const pxR = Math.max(10, b.r * Math.hypot(m.a, m.b)) * BALL3D_RADIUS_FIX;
                    c.save();
                    c.setTransform(1, 0, 0, 1, 0, 0);
                    Ball3D.draw(c, sx, sy, pxR, ballSpec3D(resolveUniform('ball')), { yaw: b.yaw3d, pitch: b.pitch3d });
                    c.restore();
                } else {
                    Ball3D.draw(c, b.x, b.y, b.r * BALL3D_RADIUS_FIX, ballSpec3D(resolveUniform('ball')), { yaw: b.yaw3d, pitch: b.pitch3d });
                }
                return;
            }
            c.save();
            c.translate(b.x, b.y);
            paintBall(c, b.r, resolveUniform('ball'), true);
            c.restore()
        }

        // Desenha texto em unidades do mundo sem depender de fonte < 1px (que o navegador arredonda e vira "borrão").
        function drawWorldText(c, text, x, y, size, lineW, shadowOn, shadowBlur, centerInk, family, weight) {
            const K = 100;
            const sc = (c.getTransform && c.getTransform().a) || 1;
            c.save();
            c.translate(x, y);
            c.scale(1 / K, 1 / K);
            c.font = (weight || '900') + ' ' + (size * K) + 'px ' + (family || 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif');
            c.lineWidth = lineW * K;
            c.lineJoin = 'round';
            if (shadowOn) {
                c.shadowColor = 'rgba(0,0,0,1)';
                c.shadowBlur = shadowBlur * sc;
                c.shadowOffsetX = .06 * sc;
                c.shadowOffsetY = .06 * sc;
            }
            let ox = 0, oy = 0;
            if (centerInk) {
                // Centraliza pelo contorno real do texto (o baseline 'middle' deixa o glifo torto).
                c.textBaseline = 'alphabetic';
                const mt = c.measureText(text);
                ox = -(mt.actualBoundingBoxRight - mt.actualBoundingBoxLeft) / 2;
                oy = (mt.actualBoundingBoxAscent - mt.actualBoundingBoxDescent) / 2;
            }
            c.strokeText(text, ox, oy);
            c.fillText(text, ox, oy);
            c.restore();
        }
        const TEAM_STRONG_COLOR = { red: '#ff1f1f', blue: '#1a6bff' };
        function drawPlayer(c, p, avatar, hitboxOpacity=.2, useCustomImage=false, uniformOverride) {
            c.save();
            c.translate(p.x, p.y);
            const auraA = Math.max(0, Math.min(1, hitboxOpacity));
            // A hitbox visual fica ATRÁS do boneco: somente ela pisca, sem alterar a skin/avatar.
            c.save();
            c.globalAlpha = auraA;
            c.beginPath();
            c.arc(0, 0, p.r * 1.20, 0, Math.PI * 2);
            c.fillStyle = TEAM_STRONG_COLOR[p.team === 'blue' ? 'blue' : 'red'];
            c.fill();
            c.restore();
            // Borda da hitbox também pertence ao efeito visual e acompanha o pisca.
            c.save();
            c.globalAlpha = auraA;
            c.beginPath();
            c.arc(0, 0, p.r * 1.20, 0, Math.PI * 2);
            c.strokeStyle = TEAM_STRONG_COLOR[p.team === 'blue' ? 'blue' : 'red'];
            c.lineWidth = Math.max(.035, p.r * .11);
            c.stroke();
            c.restore();
            // Corpo: disco preto com borda grossa na cor do time (vermelho/azul).
            const ringColor = TEAM_STRONG_COLOR[p.team === 'blue' ? 'blue' : 'red'];
            const inner = p.r * .867;
            c.save();
            c.beginPath();
            c.arc(0, 0, inner, 0, Math.PI * 2);
            c.clip();
            const playerUni = uniformOverride !== undefined ? uniformOverride : (useCustomImage ? resolveUniform('player') : null);
            if (playerUni) {
                paintUniformPattern(c, inner, playerUni);
            } else {
                c.fillStyle = '#000';
                c.fillRect(-p.r, -p.r, p.r * 2, p.r * 2);
            }
            if (useCustomImage && customization.playerImage && customPlayerImg.complete && customPlayerImg.naturalWidth) {
                drawCustomizedImage(c, customPlayerImg, inner, customization.playerZoom, customization.playerX, customization.playerY)
            }
            c.restore();
            c.beginPath();
            c.arc(0, 0, (p.r + inner) / 2, 0, Math.PI * 2);
            c.strokeStyle = '#000';
            c.lineWidth = p.r - inner;
            c.stroke();
            if (avatar && !(playerUni && playerUni.img && playerUni.img.complete && playerUni.img.naturalWidth) && !(useCustomImage && customization.playerImage && customPlayerImg.complete && customPlayerImg.naturalWidth)) {
                c.fillStyle = (playerUni && playerUni.text) || '#fff';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.strokeStyle = (playerUni && playerUni.textStroke) || '#000';
                // Estilo HaxBall: Arial negrito, branco com contorno fino escuro, sem sombra, centralizado.
                drawWorldText(c, avatar, 0, 0, p.r * .88, p.r * .07, false, 0, true, 'Arial,"Helvetica Neue",Helvetica,"Segoe UI Emoji","Noto Color Emoji",sans-serif', '700');
            }
            c.restore()
        }
        /* Banco de reservas na lateral do campo (só visual: reservas não existem na simulação).
           Vermelho à esquerda do meio-campo, azul à direita, na faixa livre abaixo da linha lateral. */
        function drawBench(c, e, m) {
            if (mode !== 'online') return;
            const list = roomPlayers.filter(pl => pl.bench);
            const now = performance.now();
            e._benchSeen = e._benchSeen || {};
            const seen = e._benchSeen;
            Object.keys(seen).forEach(k => { if (!list.some(pl => pl.cid === +k)) delete seen[k]; });
            const L = m.BallAreaSettings.Line, ph = m.PlayerAreaSettings.height;
            const bx0 = L[0].x1, bx1 = L[0].x2, by1 = L[1].y1, free = ph - by1;
            if (free < 2.4 || !list.length) return;
            const cxm = (bx0 + bx1) / 2, cy = by1 + free / 2, barH = Math.min(1.7, free - .6);
            const SP = 1.5, R = .62, cap = Math.max(2, Math.min(6, Math.floor(((bx1 - bx0) / 2 - 1.8) / SP)));
            for (const side of [1, 2]) {
                const team = side === 1 ? 'red' : 'blue', dir = side === 1 ? -1 : 1;
                const mem = list.filter(pl => pl.bench === side);
                if (!mem.length) continue;
                const shown = mem.slice(0, cap), extra = mem.length - shown.length;
                const w = cap * SP + .5, xs = cxm + dir * 1.2, xa = dir < 0 ? xs - w : xs;
                c.save();
                // banco: base escura, faixa na cor do time e encosto
                c.fillStyle = 'rgba(225,228,235,.42)';
                c.beginPath(); c.roundRect(xa, cy - barH / 2, w, barH, .35); c.fill();
                c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = .04; c.stroke();
                c.fillStyle = TEAM_STRONG_COLOR[team]; c.globalAlpha = .85;
                c.beginPath(); c.roundRect(xa, cy + barH / 2 - .16, w, .16, .08); c.fill();
                c.globalAlpha = .9; c.fillStyle = 'rgba(255,255,255,.35)';
                c.beginPath(); c.roundRect(xa + .1, cy - barH / 2 + .08, w - .2, .12, .06); c.fill();
                c.restore();
                shown.forEach((pl, i) => {
                    const px = dir < 0 ? xs - .25 - SP * (i + .5) : xs + .25 + SP * (i + .5);
                    if (seen[pl.cid] == null) seen[pl.cid] = now;
                    const t = Math.min(1, (now - seen[pl.cid]) / 350), k = 1 - Math.pow(1 - t, 3);
                    const py = cy - .08 + (1 - k) * 1.2;
                    c.save(); c.globalAlpha = k;
                    drawPlayer(c, { x: px, y: py, r: R, team }, pl.avatar || '', 0, !!pl.self, !pl.self && pl.kit ? FH_EXCL.kitSpec(pl.kit) || undefined : undefined);
                    c.textAlign = 'center'; c.textBaseline = 'top';
                    c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,.98)';
                    drawWorldText(c, pl.nick || '', px, py + R + .05, .24, .04, false, 0);
                    c.restore();
                });
                if (extra > 0) {
                    c.save(); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.strokeStyle = 'rgba(0,0,0,.9)';
                    drawWorldText(c, '+' + extra, dir < 0 ? xa + .35 : xa + w - .35, cy - barH / 2 + .3, .3, .05, false, 0);
                    c.restore();
                }
            }
        }
        function draw() {
            const e = engine
              , m = e.m
              , c = e.ctx
              , W = innerWidth
              , H = innerHeight
              , dpr = e.renderDPR || getRenderDPR();
            c.setTransform(dpr, 0, 0, dpr, 0, 0);
            c.clearRect(0, 0, W, H);
            c.fillStyle = '#285f32';
            c.fillRect(0, 0, W, H);
            const pw = m.PlayerAreaSettings.width
              , ph = m.PlayerAreaSettings.height
              , zoomEff = (e.replayCam && e.replayCam.active) ? e.replayCam.zoom : gameZoom
              , scale = Math.max(Math.min(W / (15.2 / zoomEff), H / (9.4 / zoomEff)), W / pw, H / ph) // nunca mostra além do mapa (sem bordas verdes)
              , viewW = W / scale
              , viewH = H / scale
              , cp = e.players[0]
              , b = e.ball;
            let focusX, focusY;
            if (spectatorMode) {
                focusX = pw * .5;
                focusY = ph * .5;
            } else if (cameraStyle === 1) {
                // Foco no jogador: a câmera segue o jogador; só puxa para a bola (um pouco) quando ela está na tela dele.
                const t = Math.max(Math.abs(b.x - cp.x) / (viewW / 2), Math.abs(b.y - cp.y) / (viewH / 2));
                const pull = t < .85 ? .35 : (t < 1 ? .35 * (1 - (t - .85) / .15) : 0);
                focusX = cp.x + (b.x - cp.x) * pull;
                focusY = cp.y + (b.y - cp.y) * pull;
            } else {
                focusX = (cp.x + b.x) * .5;
                focusY = (cp.y + b.y) * .5;
            }
            const targetX = focusX
              , targetY = focusY + (cameraOffset / 100) * viewH * .35;
            e.camX = spectatorMode ? targetX : (e.camX ?? targetX) + (targetX - (e.camX ?? targetX)) * .18;
            e.camY = spectatorMode ? targetY : (e.camY ?? targetY) + (targetY - (e.camY ?? targetY)) * .18;
            if (e.replayCam && e.replayCam.active) { e.camX = e.replayCam.x; e.camY = e.replayCam.y; }
            const cx = viewW >= pw ? pw / 2 : Math.max(viewW / 2, Math.min(pw - viewW / 2, e.camX))
              , cy = viewH >= ph ? ph / 2 : Math.max(viewH / 2, Math.min(ph - viewH / 2, e.camY))
              , ox = W / 2 - cx * scale
              , oy = H / 2 - cy * scale;
            e._view = { scale: scale, ox: ox, oy: oy, pw: pw, ph: ph };
            c.save();
            c.translate(ox, oy);
            c.scale(scale, scale);
            if (!engine.fieldTexture || engine.fieldTextureW !== pw || engine.fieldTextureH !== ph) {
                const fc = document.createElement('canvas');
                const FS = 80;
                fc.width = Math.max(1, Math.ceil(pw * FS));
                fc.height = Math.max(1, Math.ceil(ph * FS));
                const g = fc.getContext('2d');
                g.scale(FS, FS);
                const theme = courtTheme();
                if (m.style === 'real' || theme.grass) {
                    // gramado listrado (Real Soccer e quadra "Gramado")
                    g.fillStyle = '#3f7f47';
                    g.fillRect(0, 0, pw, ph);
                    const stripeW = 2.60;
                    for (let x = 0, i = 0; x < pw; x += stripeW,
                    i++) {
                        g.fillStyle = (i % 2 === 0) ? '#4a8a4f' : '#2f6535';
                        g.fillRect(x, 0, Math.min(stripeW, pw - x), ph)
                    }
                } else {
                    // quadra de futsal: piso externo + quadra colorida com brilho de verniz
                    const L = m.BallAreaSettings.Line;
                    const qx = L[0].x1, qy = L[0].y1, qw = L[0].x2 - L[0].x1, qh = L[1].y1 - L[0].y1;
                    g.fillStyle = theme.outer;
                    g.fillRect(0, 0, pw, ph);
                    const og = g.createLinearGradient(0, 0, 0, ph);
                    og.addColorStop(0, 'rgba(0,0,0,.18)');
                    og.addColorStop(.5, 'rgba(0,0,0,0)');
                    og.addColorStop(1, 'rgba(0,0,0,.22)');
                    g.fillStyle = og;
                    g.fillRect(0, 0, pw, ph);
                    g.fillStyle = theme.court;
                    g.fillRect(qx, qy, qw, qh);
                    if (theme.wood) {
                        // tábuas de madeira
                        const plank = Math.max(.5, qh / 26);
                        for (let y = qy, i = 0; y < qy + qh; y += plank, i++) {
                            g.fillStyle = i % 2 ? 'rgba(90,50,15,.10)' : 'rgba(255,230,180,.07)';
                            g.fillRect(qx, y, qw, Math.min(plank, qy + qh - y));
                            g.fillStyle = 'rgba(70,35,10,.22)';
                            g.fillRect(qx, y, qw, .02);
                        }
                        for (let y = qy, i = 0; y < qy + qh; y += plank, i++) {
                            const off = (i % 3) * plank * 2.2 + 1;
                            for (let x = qx + off; x < qx + qw; x += plank * 6.5) {
                                g.fillStyle = 'rgba(70,35,10,.2)';
                                g.fillRect(x, y, .02, Math.min(plank, qy + qh - y));
                            }
                        }
                    } else {
                        const cg = g.createLinearGradient(qx, qy, qx, qy + qh);
                        cg.addColorStop(0, theme.court2);
                        cg.addColorStop(.5, theme.court);
                        cg.addColorStop(1, theme.court2);
                        g.fillStyle = cg;
                        g.fillRect(qx, qy, qw, qh);
                    }
                    // brilho de verniz (reflexos diagonais suaves)
                    g.save();
                    g.beginPath();
                    g.rect(qx, qy, qw, qh);
                    g.clip();
                    for (const [f, wdt, a] of [[.22, .10, .10], [.62, .05, .07], [.8, .14, .06]]) {
                        const sx = qx + qw * f, sk = qh * .6;
                        const gr = g.createLinearGradient(sx, 0, sx + qw * wdt, 0);
                        gr.addColorStop(0, 'rgba(255,255,255,0)');
                        gr.addColorStop(.5, 'rgba(255,255,255,' + a + ')');
                        gr.addColorStop(1, 'rgba(255,255,255,0)');
                        g.fillStyle = gr;
                        g.beginPath();
                        g.moveTo(sx, qy);
                        g.lineTo(sx + qw * wdt, qy);
                        g.lineTo(sx + qw * wdt - sk, qy + qh);
                        g.lineTo(sx - sk, qy + qh);
                        g.closePath();
                        g.fill();
                    }
                    g.restore();
                }
                engine.fieldTexture = fc;
                engine.fieldTextureW = pw;
                engine.fieldTextureH = ph;
            }
            c.drawImage(engine.fieldTexture, 0, 0, pw, ph);
            (function drawCompleteField() {
                const x1 = m.BallAreaSettings.Line[0].x1
                  , x2 = m.BallAreaSettings.Line[0].x2;
                const y1 = m.BallAreaSettings.Line[0].y1
                  , y2 = m.BallAreaSettings.Line[1].y1;
                const w = x2 - x1
                  , h = y2 - y1
                  , cx = (x1 + x2) / 2
                  , cy = (y1 + y2) / 2;
                const line = Math.max(.065, Math.min(.105, w * .00215));
                const spotR = Math.max(.055, line * .82);
                const penaltyDepth = w * (16.5 / 105);
                const penaltyHalf = h * (40.32 / 68) / 2;
                const goalDepth = w * (5.5 / 105);
                const gLine = m.GoalProperty.GoalLine[0];
                // a pequena área passa exatamente pelo centro das traves (mesmas coordenadas da colisão)
                const goalHalf = gLine ? (gLine.y2 - gLine.y1) / 2 : h * (18.32 / 68) / 2;
                const goalCy = gLine ? (gLine.y1 + gLine.y2) / 2 : cy;
                const arcR = w * (9.15 / 105);
                const cornerR = Math.min(w * .0125, h * .025);
                c.save();
                c.strokeStyle = customization.lineColor;
                c.fillStyle = '#ffffff';
                c.lineWidth = line;
                c.globalAlpha = .97;
                c.setLineDash([]);
                c.lineCap = 'butt';
                c.lineJoin = 'miter';

                // Contorno externo totalmente contínuo.
                c.beginPath();
                c.moveTo(x1, y1);
                c.lineTo(x2, y1);
                c.lineTo(x2, y2);
                c.lineTo(x1, y2);
                c.closePath();
                c.stroke();

                // Meio-campo, círculo e marca central.
                c.beginPath();
                c.moveTo(cx, y1);
                c.lineTo(cx, y2);
                c.stroke();
                c.beginPath();
                c.arc(cx, cy, w * (9.15 / 105), 0, Math.PI * 2);
                c.stroke();
                c.beginPath();
                c.arc(cx, cy, spotR, 0, Math.PI * 2);
                c.fill();

                const futsalLines = m.style !== 'real';
                if (futsalLines) {
                    // Quadra de futsal: áreas em quarto de círculo a partir das traves, marcas de 6 m e 10 m.
                    const R = Math.min(h * .3, w * .22);
                    const gTop = goalCy - goalHalf, gBot = goalCy + goalHalf;
                    for (let side = 0; side < 2; side++) {
                        c.save();
                        if (side) {
                            c.translate(2 * cx, 0);
                            c.scale(-1, 1);
                        }
                        c.beginPath();
                        c.arc(x1, gTop, R, -Math.PI / 2, 0);
                        c.lineTo(x1 + R, gBot);
                        c.arc(x1, gBot, R, 0, Math.PI / 2);
                        c.stroke();
                        c.beginPath();
                        c.arc(x1 + R, cy, spotR, 0, Math.PI * 2);
                        c.fill();
                        c.beginPath();
                        c.arc(x1 + R * 10 / 6, cy, spotR, 0, Math.PI * 2);
                        c.fill();
                        c.restore();
                    }
                } else {
                // ÁREAS: o lado ESQUERDO é a referência e NÃO é alterado.
                // O lado DIREITO é desenhado como um espelho geométrico EXATO do esquerdo.
                const leftPenaltyX = x1 + penaltyDepth;
                const leftGoalX = x1 + goalDepth;
                const leftSpotX = x1 + penaltyDepth * (12 / 16.5);

                // ESQUERDA — referência original.
                c.beginPath();
                c.moveTo(x1, cy - penaltyHalf);
                c.lineTo(leftPenaltyX, cy - penaltyHalf);
                c.moveTo(x1, cy + penaltyHalf);
                c.lineTo(leftPenaltyX, cy + penaltyHalf);
                c.moveTo(leftPenaltyX, cy - penaltyHalf);
                c.lineTo(leftPenaltyX, cy + penaltyHalf);
                c.stroke();
                c.beginPath();
                c.moveTo(x1, goalCy - goalHalf);
                c.lineTo(leftGoalX, goalCy - goalHalf);
                c.moveTo(x1, goalCy + goalHalf);
                c.lineTo(leftGoalX, goalCy + goalHalf);
                c.moveTo(leftGoalX, goalCy - goalHalf);
                c.lineTo(leftGoalX, goalCy + goalHalf);
                c.stroke();
                c.beginPath();
                c.arc(leftSpotX, cy, spotR, 0, Math.PI * 2);
                c.fill();
                c.beginPath();
                c.arc(leftSpotX, cy, arcR, -Math.PI / 3, Math.PI / 3);
                c.stroke();

                // DIREITA — espelho EXATO do lado esquerdo. Nenhuma medida independente.
                c.save();
                c.translate(2 * cx, 0);
                c.scale(-1, 1);
                const rightPenaltyX = x1 + penaltyDepth;
                const rightGoalX = x1 + goalDepth;
                const rightSpotX = x1 + penaltyDepth * (12 / 16.5);
                c.beginPath();
                c.moveTo(x1, cy - penaltyHalf);
                c.lineTo(rightPenaltyX, cy - penaltyHalf);
                c.moveTo(x1, cy + penaltyHalf);
                c.lineTo(rightPenaltyX, cy + penaltyHalf);
                c.moveTo(rightPenaltyX, cy - penaltyHalf);
                c.lineTo(rightPenaltyX, cy + penaltyHalf);
                c.stroke();
                c.beginPath();
                c.moveTo(x1, goalCy - goalHalf);
                c.lineTo(rightGoalX, goalCy - goalHalf);
                c.moveTo(x1, goalCy + goalHalf);
                c.lineTo(rightGoalX, goalCy + goalHalf);
                c.moveTo(rightGoalX, goalCy - goalHalf);
                c.lineTo(rightGoalX, goalCy + goalHalf);
                c.stroke();
                c.beginPath();
                c.arc(rightSpotX, cy, spotR, 0, Math.PI * 2);
                c.fill();
                c.beginPath();
                c.arc(rightSpotX, cy, arcR, -Math.PI / 3, Math.PI / 3);
                c.stroke();
                c.restore();
                }

                // Arcos dos quatro escanteios, encostando exatamente nas linhas externas.
                for (const [px,py,a0,a1] of [[x1, y1, 0, Math.PI / 2], [x2, y1, Math.PI / 2, Math.PI], [x2, y2, Math.PI, 3 * Math.PI / 2], [x1, y2, 3 * Math.PI / 2, 2 * Math.PI]]) {
                    c.beginPath();
                    c.arc(px, py, cornerR, a0, a1);
                    c.stroke();
                }
                c.restore();
            }
            )();
            if (graphicsSettings.showGoalSprites && GOAL_STYLE !== 'sprite')
                drawGoalsBack(c, e);
            else if (!graphicsSettings.showGoalSprites)
                drawGoals2DBack(c, e);
            if (e.restart) {
                const rs = e.restart, pulse = .5 + .5 * Math.sin(performance.now() / 180);
                c.save();
                c.strokeStyle = rs.team === 'red' ? '#ff4d4d' : '#4da6ff';
                c.globalAlpha = .45 + .4 * pulse;
                c.lineWidth = .07;
                c.beginPath();
                c.arc(rs.x, rs.y, .85 + .12 * pulse, 0, Math.PI * 2);
                c.stroke();
                c.restore();
            }
            drawBench(c, e, m);
            drawBall(c, e.ball);
            for (const p of e.players) {
                if (mode !== 'ai' && mode !== 'online' && p !== e.players[0])
                    continue;
                const tag = p === e.players[0] ? (p.nick || state.nick || 'Jogador') : (p.nick || '')
                  , av = p === e.players[0] ? (p.avatar || state.avatar || 'P1') : (mode === 'online' ? (p.avatar || '') : '');
                const flashKick = e.kickFlash > 0
                  , flashPass = e.passFlash > 0;
                const hitboxOpacity = p === e.players[0] ? .15 : 0;
                drawPlayer(c, p, av, hitboxOpacity, p === e.players[0], p !== e.players[0] && p.kit ? FH_EXCL.kitSpec(p.kit) || undefined : undefined);
                if (p === e.players[0] && (flashKick || flashPass)) {
                    const remaining = Math.max(e.kickFlash, e.passFlash);
                    const duration = .22;
                    const progress = 1 - remaining / duration;
                    // Faixa branca (mesmo visual da hitbox) em volta do personagem, mais forte no instante do chute.
                    const outer = p.r * (1.2 + progress * .12);
                    c.save();
                    const flashCol = TEAM_STRONG_COLOR[p.team === 'blue' ? 'blue' : 'red'];
                    c.globalAlpha = Math.max(.15, .75 * (1 - progress));
                    c.fillStyle = flashCol;
                    c.beginPath();
                    c.arc(p.x, p.y, outer, 0, Math.PI * 2);
                    c.arc(p.x, p.y, p.r, 0, Math.PI * 2, true);
                    c.fill('evenodd');
                    c.beginPath();
                    c.arc(p.x, p.y, outer, 0, Math.PI * 2);
                    c.strokeStyle = flashCol;
                    c.lineWidth = Math.max(.035, p.r * .11);
                    c.stroke();
                    c.restore();
                }
                c.save();
                c.textAlign = 'center';
                c.textBaseline = 'top';
                c.fillStyle = '#fff';
                c.strokeStyle = 'rgba(0,0,0,.98)';
                drawWorldText(c, tag, p.x, p.y + p.r + .055, .26, .045, graphicsSettings.showPlayerShadows, .30);
                c.restore();
            }
            if (graphicsSettings.showGoalSprites) {
                if (GOAL_STYLE === 'sprite')
                    drawGoals(c, m);
                else
                    drawGoalsFront(c, e);
            } else
                drawGoals2DFront(c, e);
            if (!spectatorMode && graphicsSettings.showBallGuide && e.players[0])
                drawBallPointer(c, e.players[0], e.ball);
            if (e.goalAnim && e.goalAnim.fx)
                FH_GOALFX.drawWorld(c, e.goalAnim, e.ball, e.players[0] ? e.players[0].r : 1);
            c.restore();
            const ballSX = ox + e.ball.x * scale
              , ballSY = oy + e.ball.y * scale;
            if (!spectatorMode && graphicsSettings.showBallGuide)
                drawBallGuide(c, W, H, ballSX, ballSY);
            $('rs').textContent = e.red;
            $('bs').textContent = e.blue;
            $('time').textContent = fmt(e.time);
            if (e.restart && !e.goalAnim) {
                const names = { throw: 'LATERAL', corner: 'ESCANTEIO', goalkick: 'TIRO DE META' };
                const label = names[e.restart.type] + ' • ' + (e.restart.team === 'red' ? 'VERMELHO' : 'AZUL');
                const fs = Math.max(15, Math.min(26, W * .028));
                c.save();
                c.font = '800 ' + fs + 'px Poppins, Arial, sans-serif';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                const tw = c.measureText(label).width + fs * 1.6, th = fs * 1.9, tx = W / 2, ty = Math.max(70, H * .14);
                c.fillStyle = 'rgba(0,0,0,.55)';
                c.beginPath();
                c.roundRect(tx - tw / 2, ty - th / 2, tw, th, th / 2);
                c.fill();
                c.fillStyle = e.restart.team === 'red' ? '#ff6b6b' : '#6bb8ff';
                c.fillText(label, tx, ty + 1);
                c.restore();
            }
            if (e.goalAnim && e.goalAnim.fx)
                FH_GOALFX.drawScreen(c, e.goalAnim, W, H);
            if (e.goalAnim)
                drawGoalAnimation(c, e.goalAnim, W, H);
            else if (!e.running && !e.paused) {
                c.fillStyle = '#0008';
                c.fillRect(0, 0, W, H);
                drawFinished(c, W, H)
            }
        }
        function drawGoalAnimation(c, g, W, H) {
            let t = g.t
              , team = g.team
              , cx = W / 2
              , cy = H / 2;
            const col = team === 'red' ? '#ff2b2b' : '#159cff';
            const label = 'GOL!';
            const scorerName = g.scorerName || (team === 'red' ? 'Time vermelho' : 'Time azul');
            c.save();
            c.fillStyle = 'rgba(0,0,0,.28)';
            c.fillRect(0, 0, W, H);
            let p = Math.min(1, t / .28)
              , s = 1 + .12 * Math.sin(t * 12) * Math.min(1, t);
            c.translate(cx, cy);
            c.scale(s, s);
            c.globalAlpha = p;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.font = '900 ' + Math.round(Math.min(W, H) * .12) + 'px Arial';
            c.lineWidth = 8;
            c.strokeStyle = '#111';
            c.strokeText(label, 0, -Math.min(H * .055, 42));
            c.fillStyle = col;
            c.fillText(label, 0, -Math.min(H * .055, 42));
            let nameSize = Math.max(14, Math.round(Math.min(W, H) * .065));
            c.font = '800 ' + nameSize + 'px Arial';
            while (c.measureText(scorerName).width > W * .84 && nameSize > 14) {
                nameSize -= 2;
                c.font = '800 ' + nameSize + 'px Arial';
            }
            c.lineWidth = 5;
            c.strokeText(scorerName, 0, Math.min(H * .055, 42));
            c.fillStyle = '#fff';
            c.fillText(scorerName, 0, Math.min(H * .055, 42));
            c.restore();
        }
        function drawFinished(c, W, H) {
            c.save();
            c.fillStyle = 'rgba(0,0,0,.28)';
            c.fillRect(0, 0, W, H);
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.font = '900 ' + Math.round(Math.min(W, H) * .10) + 'px Arial';
            c.lineWidth = 6;
            c.strokeStyle = '#111';
            c.strokeText('FIM DE JOGO', W / 2, H / 2);
            c.fillStyle = '#a8a8a8';
            c.fillText('FIM DE JOGO', W / 2, H / 2);
            c.restore();
        }

        let fpsFrameCount = 0;
        let fpsLastUpdate = 0;
        let lastFrameRendered = 0;
        function updatePerformanceHud(now) {
            fpsFrameCount++;
            if (!fpsLastUpdate)
                fpsLastUpdate = now;
            const elapsed = now - fpsLastUpdate;
            if (elapsed < 500)
                return;
            const fps = Math.round(fpsFrameCount * 1000 / elapsed);
            $('fpsDisplay').textContent = `FPS: ${fps}`;
            fpsFrameCount = 0;
            fpsLastUpdate = now
        }

        /* Estilo do gol: 'physics' = traves e rede desenhadas com física (padrão); 'sprite' = imagem antiga. */
        const GOAL_STYLE = 'physics';
        function drawTube(c, x1, y1, x2, y2, w) {
            c.save();
            c.lineCap = 'round';
            c.beginPath();
            c.moveTo(x1 + .04, y1 + .06);
            c.lineTo(x2 + .04, y2 + .06);
            c.strokeStyle = 'rgba(0,0,0,.26)';
            c.lineWidth = w + .05;
            c.stroke();
            c.beginPath();
            c.moveTo(x1, y1);
            c.lineTo(x2, y2);
            c.strokeStyle = '#cfd6dc';
            c.lineWidth = w;
            c.stroke();
            c.beginPath();
            c.moveTo(x1 - w * .14, y1 - w * .14);
            c.lineTo(x2 - w * .14, y2 - w * .14);
            c.strokeStyle = '#ffffff';
            c.lineWidth = w * .42;
            c.stroke();
            c.restore();
        }
        /* Gol em 3D: câmera virtual na frente do gol. Tudo que é alto (travessão, teto da rede, topo das
           traves) é desenhado deslocado/ampliado a partir dela, então o gol "ganha altura". Os pés das
           traves ficam exatamente sobre a linha do campo (mesma posição usada na colisão). */
        const GOAL_PERSP = .15, GOAL_LV = 6;
        function goalProj(n, x, y, hf) {
            const cx = n.x0 - n.dir * 3.2, cy = (n.y1 + n.y2) / 2, s = 1 + GOAL_PERSP * hf;
            return [cx + (x - cx) * s, cy + (y - cy) * s];
        }
        function drawNetPlane(c, rows, fillA, lineA) {
            const LV = rows.length - 1, K = rows[0].length - 1;
            c.beginPath();
            for (let k = 0; k <= K; k++)
                k ? c.lineTo(rows[0][k][0], rows[0][k][1]) : c.moveTo(rows[0][k][0], rows[0][k][1]);
            for (let k = K; k >= 0; k--)
                c.lineTo(rows[LV][k][0], rows[LV][k][1]);
            c.closePath();
            c.fillStyle = 'rgba(255,255,255,' + fillA + ')';
            c.fill();
            c.strokeStyle = 'rgba(255,255,255,' + lineA + ')';
            c.lineWidth = .02;
            c.beginPath();
            for (let l = 0; l <= LV; l++)
                for (let k = 0; k <= K; k++)
                    k ? c.lineTo(rows[l][k][0], rows[l][k][1]) : c.moveTo(rows[l][k][0], rows[l][k][1]);
            for (let k = 0; k <= K; k++)
                for (let l = 0; l <= LV; l++)
                    l ? c.lineTo(rows[l][k][0], rows[l][k][1]) : c.moveTo(rows[l][k][0], rows[l][k][1]);
            c.stroke();
        }
        // Parte de baixo do gol (desenhada ANTES da bola): chão sombreado e redes verticais (fundo e laterais).
        /* Gol simples em 2D (visto de cima), usado quando "Detalhes visuais dos gols" está desligado:
           área da rede levemente escurecida, contorno do gol e traves como círculos. Sem animação nem 3D. */
        function drawGoals2DBack(c, e) {
            for (const n of ensureNets(e)) {
                const xa = Math.min(n.x0, n.xb), xw = Math.abs(n.xb - n.x0);
                c.save();
                c.fillStyle = 'rgba(0,0,0,.22)';
                c.fillRect(xa, n.y1, xw, n.y2 - n.y1);
                c.strokeStyle = 'rgba(255,255,255,.9)';
                c.lineWidth = Math.max(.05, n.pr * .55);
                c.lineJoin = 'round';
                c.lineCap = 'round';
                c.beginPath();
                c.moveTo(n.x0, n.y1);
                c.lineTo(n.xb, n.y1);
                c.lineTo(n.xb, n.y2);
                c.lineTo(n.x0, n.y2);
                c.stroke();
                c.restore();
            }
        }
        function drawGoals2DFront(c, e) {
            for (const n of ensureNets(e)) {
                c.save();
                for (const pt of n.post) {
                    c.beginPath();
                    c.arc(pt.x, pt.y, n.pr, 0, Math.PI * 2);
                    c.fillStyle = '#ffffff';
                    c.fill();
                    c.lineWidth = Math.max(.025, n.pr * .28);
                    c.strokeStyle = '#2b2b2b';
                    c.stroke();
                }
                c.restore();
            }
        }
        function drawGoalsBack(c, e) {
            for (const n of ensureNets(e)) {
                const xa = Math.min(n.x0, n.xb), xw = Math.abs(n.xb - n.x0);
                const hy = (n.y2 - n.y1) / NET_NY, hx = n.depth / NET_NX;
                c.save();
                const gr = c.createLinearGradient(n.x0, 0, n.xb, 0);
                gr.addColorStop(0, 'rgba(0,0,0,.05)');
                gr.addColorStop(1, 'rgba(0,0,0,.34)');
                c.fillStyle = gr;
                c.fillRect(xa, n.y1, xw, n.y2 - n.y1);
                c.lineJoin = 'round';
                // rede do fundo (plano vertical): estufa para fora quando a bola bate
                const back = [];
                for (let l = 0; l <= GOAL_LV; l++) {
                    const hf = l / GOAL_LV, row = [];
                    for (let jj = 0; jj <= NET_NY; jj++)
                        row.push(goalProj(n, n.xb + n.dir * n.back[jj] * Math.sin(Math.PI * hf), n.y1 + jj * hy, hf));
                    back.push(row);
                }
                drawNetPlane(c, back, .10, .34);
                // redes laterais
                for (const side of ['a', 'b']) {
                    const arr = side === 'a' ? n.sideA : n.sideB, y0 = side === 'a' ? n.y1 : n.y2, out = side === 'a' ? -1 : 1;
                    const rows = [];
                    for (let l = 0; l <= GOAL_LV; l++) {
                        const hf = l / GOAL_LV, row = [];
                        for (let i = 0; i <= NET_NX; i++)
                            row.push(goalProj(n, n.x0 + n.dir * i * hx, y0 + out * arr[i] * Math.sin(Math.PI * hf), hf));
                        rows.push(row);
                    }
                    drawNetPlane(c, rows, .08, .30);
                }
                c.restore();
            }
        }
        // Parte de cima do gol (desenhada DEPOIS da bola): teto da rede, armação 3D, postes e faíscas.
        function drawGoalsFront(c, e) {
            const W = NET_NY + 1;
            for (const n of ensureNets(e)) {
                const hx = n.depth / NET_NX, hy = (n.y2 - n.y1) / NET_NY;
                const px = new Float32Array((NET_NX + 1) * W), py = new Float32Array((NET_NX + 1) * W);
                for (let i = 0; i <= NET_NX; i++)
                    for (let jj = 0; jj <= NET_NY; jj++) {
                        const k = i * W + jj;
                        // a rede levantada pela bola fica mais alta (e portanto maior na perspectiva)
                        const p = goalProj(n, n.x0 + n.dir * i * hx, n.y1 + jj * hy, 1 + n.z[k] * 1.8);
                        px[k] = p[0];
                        py[k] = p[1];
                    }
                c.save();
                c.lineJoin = 'round';
                c.lineCap = 'round';
                c.lineWidth = .024;
                c.strokeStyle = 'rgba(255,255,255,.44)';
                c.beginPath();
                for (let i = 0; i <= NET_NX; i++)
                    for (let jj = 0; jj <= NET_NY; jj++) {
                        const k = i * W + jj;
                        jj ? c.lineTo(px[k], py[k]) : c.moveTo(px[k], py[k]);
                    }
                for (let jj = 0; jj <= NET_NY; jj++)
                    for (let i = 0; i <= NET_NX; i++) {
                        const k = i * W + jj;
                        i ? c.lineTo(px[k], py[k]) : c.moveTo(px[k], py[k]);
                    }
                c.stroke();
                c.strokeStyle = 'rgba(255,255,255,.6)';
                c.lineWidth = .034;
                c.beginPath();
                for (let i = 1; i < NET_NX; i++)
                    for (let jj = 1; jj < NET_NY; jj++) {
                        const k = i * W + jj;
                        if (n.z[k] > .045) {
                            c.moveTo(px[k], py[k]);
                            c.lineTo(px[k + 1], py[k + 1]);
                            c.moveTo(px[k], py[k]);
                            c.lineTo(px[k + W], py[k + W]);
                        }
                    }
                c.stroke();
                c.restore();
                // armação 3D: pés no chão (sobre a linha do campo) e topo na altura do gol
                const T = (x, y) => goalProj(n, x, y, 1);
                const f1 = T(n.x0, n.y1), f2 = T(n.x0, n.y2), b1 = T(n.xb, n.y1), b2 = T(n.xb, n.y2);
                const w = n.pr * 1.1;
                // pés (chão): sombra + base de cada poste na linha do gol
                for (const y of [n.y1, n.y2]) {
                    c.save();
                    c.fillStyle = 'rgba(0,0,0,.30)';
                    c.beginPath();
                    c.arc(n.x0 + .05, y + .07, n.pr * 1.15, 0, Math.PI * 2);
                    c.fill();
                    c.restore();
                }
                // traves de trás (mais longe)
                const bb1 = [n.xb, n.y1], bb2 = [n.xb, n.y2];
                drawTube(c, bb1[0], bb1[1], b1[0], b1[1], w * .8);
                drawTube(c, bb2[0], bb2[1], b2[0], b2[1], w * .8);
                // topo: fundo e laterais
                drawTube(c, b1[0], b1[1], b2[0], b2[1], w * .8);
                drawTube(c, f1[0], f1[1], b1[0], b1[1], w * .8);
                drawTube(c, f2[0], f2[1], b2[0], b2[1], w * .8);
                // traves da frente: pé -> topo, e travessão
                drawTube(c, n.x0, n.y1, f1[0], f1[1], w * 1.25);
                drawTube(c, n.x0, n.y2, f2[0], f2[1], w * 1.25);
                drawTube(c, f1[0], f1[1], f2[0], f2[1], w * 1.25);
                // base e topo dos postes da frente
                for (let k = 0; k < 2; k++) {
                    const pt = n.post[k], top = k === 0 ? f1 : f2;
                    const R = n.pr * (1 + .22 * pt.amp * Math.cos(pt.t * 42));
                    c.save();
                    // pé do poste, centrado na linha do campo
                    const gr0 = c.createRadialGradient(pt.x - R * .3, pt.y - R * .3, R * .08, pt.x, pt.y, R);
                    gr0.addColorStop(0, '#ffffff');
                    gr0.addColorStop(.6, '#dde3e8');
                    gr0.addColorStop(1, '#8b95a0');
                    c.fillStyle = gr0;
                    c.beginPath();
                    c.arc(pt.x, pt.y, R, 0, Math.PI * 2);
                    c.fill();
                    c.lineWidth = .02;
                    c.strokeStyle = 'rgba(0,0,0,.5)';
                    c.stroke();
                    c.beginPath();
                    c.arc(pt.x, pt.y, R * .5, 0, Math.PI * 2);
                    c.lineWidth = .03;
                    c.strokeStyle = n.g.team === 1 ? '#ef4444' : '#3b82f6';
                    c.stroke();
                    // tampa do topo
                    const RT = R * 1.18;
                    const gr = c.createRadialGradient(top[0] - RT * .35, top[1] - RT * .35, RT * .08, top[0], top[1], RT);
                    gr.addColorStop(0, '#ffffff');
                    gr.addColorStop(.55, '#e3e8ec');
                    gr.addColorStop(1, '#98a2ad');
                    c.fillStyle = gr;
                    c.beginPath();
                    c.arc(top[0], top[1], RT, 0, Math.PI * 2);
                    c.fill();
                    c.lineWidth = .02;
                    c.strokeStyle = 'rgba(0,0,0,.45)';
                    c.stroke();
                    if (pt.amp > .02 && pt.t < .6) {
                        c.beginPath();
                        c.arc(pt.x, pt.y, R + pt.t * 1.4, 0, Math.PI * 2);
                        c.globalAlpha = Math.min(1, pt.amp * 1.4);
                        c.strokeStyle = '#ffffff';
                        c.lineWidth = .04;
                        c.stroke();
                    }
                    c.restore();
                }
            }
            if (e.sparks && e.sparks.length) {
                c.save();
                c.lineCap = 'round';
                c.lineWidth = .04;
                for (const sp of e.sparks) {
                    c.globalAlpha = Math.max(0, Math.min(1, sp.life / sp.max * 1.6));
                    c.strokeStyle = '#fff1b3';
                    c.beginPath();
                    c.moveTo(sp.x, sp.y);
                    c.lineTo(sp.x - sp.vx * .05, sp.y - sp.vy * .05);
                    c.stroke();
                }
                c.restore();
            }
        }
        const goalLeftImg = new Image()
          , goalRightImg = new Image();
        goalLeftImg.src = GOAL_LEFT_SRC;
        goalRightImg.src = GOAL_RIGHT_SRC;
        function drawGoals(c, m) {
            // Alinha o PÉ dos postes do sprite (ponta inclinada no nível do chão) com a linha de gol
            // e com as extremidades da boca do gol (g.y1 / g.y2). Medidas em px do sprite original.
            const GOAL_SPRITE = {
                1: {tipX: 641, topY: 211, botY: 1333},
                2: {tipX: 1, topY: 222, botY: 1399}
            };
            const gl = m.GoalProperty.GoalSettings;
            for (const g of m.GoalProperty.GoalLine) {
                const img = g.team === 1 ? goalLeftImg : goalRightImg;
                if (!(img.complete && img.naturalWidth))
                    continue;
                const f = GOAL_SPRITE[g.team] || GOAL_SPRITE[1];
                const sy = (g.y2 - g.y1) / (f.botY - f.topY);
                const sx = ((gl.GoalDept + 1.02) * .92) / img.naturalWidth;
                c.drawImage(img, g.x1 - f.tipX * sx, g.y1 - f.topY * sy, img.naturalWidth * sx, img.naturalHeight * sy);
            }
        }
        /* ===== SEÇÃO 13 - LOOP PRINCIPAL ===== */
        function fmt(t) {
            t = Math.max(0, t);
            return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0')
        }
        function loop(now) {
            if (!engine)
                return;
            if (engine.replay && window.FH_REPLAY) {           // reprodução de replay: o player comanda o render
                FH_REPLAY.frame(now);
                requestAnimationFrame(loop);
                return
            }
            const frameInterval = graphicsSettings.fpsLimit > 0 ? 1000 / graphicsSettings.fpsLimit : 0;
            if (frameInterval && lastFrameRendered && now - lastFrameRendered < frameInterval) {
                requestAnimationFrame(loop);
                return
            }
            lastFrameRendered = now;
            updatePerformanceHud(now);
            if (engine.online && window.FH_ONLINE) {         // partida ONLINE: física no servidor + predição (game/online.js)
                FH_ONLINE.frame(now);
                requestAnimationFrame(loop);
                return
            }
            let dt = Math.min(.033, (now - engine.last) / 1000);
            engine.last = now;
            if (engine.goalAnim) {
                engine.goalAnim.t += dt;
                goalAftermath(dt);
                if (engine.goalAnim.t >= 2.35) {
                    const g = engine.goalAnim;
                    engine.goalAnim = null;
                    reset();
                    if (engine.red >= roomConfig.scoreLimit || engine.blue >= roomConfig.scoreLimit || engine.time <= 0) {
                        engine.running = false;
                        scheduleMatchFinish(engine);
                    } else
                        engine.running = true
                }
            } else if (engine.running && !engine.paused) {
                engine.time -= dt;
                if (engine.time <= 0) {
                    engine.time = 0;
                    engine.running = false;
                    scheduleMatchFinish(engine)
                } else
                    physics(dt)
            }
            if (window.FH_REC && FH_REC.active())
                FH_REC.tick(engine, dt);
            updateGoalNets(dt);
            draw();
            requestAnimationFrame(loop)
        }
