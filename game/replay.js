'use strict';
/* Replay do FutHub (cliente).
 *
 *  FH_REC     grava partidas OFFLINE (contra a IA) a partir do engine local,
 *             no mesmo formato .fhreplay do servidor (game/sim.js / server/replay.js).
 *  FH_LIB     biblioteca local em IndexedDB (replays offline, baixados e importados).
 *  FH_REPLAY  player: reconstroi o engine a partir de um .fhreplay e desenha com draw().
 *  FH_REPLAYS tela Replays: lista (conta online + locais), abrir, baixar, importar, apagar.
 *
 * Reutiliza os globais de game.js: engine, mode, spectatorMode, draw, updateGoalNets,
 * show, resize, loop, play, fmt, MAPS, stop.
 */
(function () {
  var FORMAT_VERSION = 1, MAGIC = 'FHREPLAY', TICK_RATE = 60, SAMPLE_EVERY = 3;
  var PH = { COUNTDOWN: 0, PLAY: 1, GOAL: 2, ENDED: 3 };
  var EV = { KICK: 1, POST: 2, NET: 3, GOAL: 4, WHISTLE: 5, RESTART: 6, END: 7 };
  function r3(v) { return Math.round((v || 0) * 1000) / 1000; }
  function teamStr(t) { return (t === 2 || t === 'blue') ? 'blue' : 'red'; }

  /* ====================== biblioteca local (IndexedDB) ====================== */
  var DB_NAME = 'futhub-replays', STORE = 'replays', _db = null;
  function openDB() {
    return new Promise(function (res, rej) {
      if (_db) return res(_db);
      if (!window.indexedDB) return rej(new Error('IndexedDB indisponivel'));
      var rq = indexedDB.open(DB_NAME, 1);
      rq.onupgradeneeded = function () { var db = rq.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' }); };
      rq.onsuccess = function () { _db = rq.result; res(_db); };
      rq.onerror = function () { rej(rq.error); };
    });
  }
  function tx(mode) { return openDB().then(function (db) { return db.transaction(STORE, mode).objectStore(STORE); }); }
  var FH_LIB = {
    put: function (rec) {
      return tx('readwrite').then(function (st) {
        return new Promise(function (res, rej) { var rq = st.put(rec); rq.onsuccess = function () { res(rec.id); }; rq.onerror = function () { rej(rq.error); }; });
      });
    },
    list: function () {
      return tx('readonly').then(function (st) {
        return new Promise(function (res, rej) {
          var out = [], rq = st.openCursor();
          rq.onsuccess = function () { var cur = rq.result; if (cur) { out.push(lightMeta(cur.value)); cur.continue(); } else res(out); };
          rq.onerror = function () { rej(rq.error); };
        });
      }).catch(function () { return []; });
    },
    get: function (id) {
      return tx('readonly').then(function (st) {
        return new Promise(function (res, rej) { var rq = st.get(id); rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { rej(rq.error); }; });
      });
    },
    del: function (id) {
      return tx('readwrite').then(function (st) {
        return new Promise(function (res, rej) { var rq = st.delete(id); rq.onsuccess = function () { res(true); }; rq.onerror = function () { rej(rq.error); }; });
      });
    }
  };
  function lightMeta(v) {
    var m = v.match || {};
    return { id: v.id, source: 'local', map: m.map, style: m.style, mode: m.mode, ranked: m.ranked, end: m.end,
      createdAt: v.savedAt || m.endedAt || Date.now(), durationSec: v.durationSec || 0, finalScore: v.finalScore || { red: 0, blue: 0 },
      teams: v.teams || { red: [], blue: [] }, size: v._size || 0,
      players: (v.participants || []).slice(0, 22).map(function (p) { return { nick: p.nick || '', avatar: p.avatar || '', team: p.team === 2 ? 'blue' : 'red' }; }) };
  }
  window.FH_LIB = FH_LIB;

  /* ====================== validacao do formato ====================== */
  function validate(obj) {
    if (!obj || typeof obj !== 'object') return 'Arquivo vazio ou invalido.';
    if (obj.magic !== MAGIC) return 'Nao e um arquivo de replay do ZunkoBall.';
    if (!(obj.formatVersion >= 1 && obj.formatVersion <= FORMAT_VERSION)) return 'Versao de replay incompativel.';
    if (!Array.isArray(obj.frames) || !obj.frames.length) return 'Replay sem quadros.';
    if (!Array.isArray(obj.events)) return 'Replay sem eventos.';
    if (!obj.match || typeof obj.match !== 'object') return 'Replay sem metadados.';
    var f0 = obj.frames[0];
    if (!f0 || !Array.isArray(f0.b) || !Array.isArray(f0.p)) return 'Quadro invalido.';
    return null;
  }
  window.FH_REPLAY_VALIDATE = validate;

  /* ====================== gravador OFFLINE (contra IA) ====================== */
  function Recorder(meta, players) {
    this.meta = meta || {};
    this.frames = []; this.events = []; this.rosterLog = [];
    this.elapsed = 0; this.tick = 0; this.lastSampleTick = -1;
    this.lastScore = 0; this.startedAt = Date.now();
    var slots = {};
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      slots[i] = { nick: String(p.nick || (i === 0 ? 'Voce' : 'IA')), av: String(p.avatar || ''), team: teamStr(p.team) === 'blue' ? 2 : 1 };
    }
    this.rosterLog.push({ tick: 0, slots: slots });
  }
  Recorder.prototype.tick_ = function (engine, dt) {
    this.elapsed += dt;
    this.tick = Math.round(this.elapsed * TICK_RATE);
    // gol: detecta por variacao de placar
    var score = (engine.red | 0) + (engine.blue | 0);
    if (score > this.lastScore) {
      var team = engine.goalAnim ? (teamStr(engine.goalAnim.team) === 'blue' ? 2 : 1) : 0;
      this.events.push([EV.GOAL, this.tick, team, engine.red | 0, engine.blue | 0, -1]);
      this.lastScore = score;
    }
    if (this.lastSampleTick >= 0 && this.tick - this.lastSampleTick < SAMPLE_EVERY) return;
    this.lastSampleTick = this.tick;
    this.sample(engine);
  };
  Recorder.prototype.sample = function (engine) {
    var ps = [];
    for (var i = 0; i < engine.players.length; i++) {
      var p = engine.players[i];
      ps.push([i, teamStr(p.team) === 'blue' ? 2 : 1, r3(p.x), r3(p.y), r3(p.vx || 0), r3(p.vy || 0), 0, 0]);
    }
    var ph = engine.goalAnim ? PH.GOAL : (engine.running ? PH.PLAY : PH.ENDED);
    var f = { t: this.tick, ph: ph, r: engine.red | 0, bl: engine.blue | 0,
      tt: Math.max(0, Math.round(engine.time * TICK_RATE)), cd: 0,
      gt: engine.goalAnim ? Math.round(engine.goalAnim.t * TICK_RATE) : 0,
      gtm: engine.goalAnim ? (teamStr(engine.goalAnim.team) === 'blue' ? 2 : 1) : 0, ls: -1,
      b: [r3(engine.ball.x), r3(engine.ball.y), r3(engine.ball.vx), r3(engine.ball.vy)], p: ps };
    this.frames.push(f);
  };
  Recorder.prototype.build = function (reason) {
    var slots = this.rosterLog[this.rosterLog.length - 1].slots, participants = [], teams = { red: [], blue: [] };
    for (var k in slots) { if (!slots.hasOwnProperty(k)) continue; var v = slots[k];
      participants.push({ slot: +k, nick: v.nick, avatar: v.av, team: v.team });
      (v.team === 2 ? teams.blue : teams.red).push(v.nick || 'Jogador'); }
    var dur = this.frames.length ? this.frames[this.frames.length - 1].t - this.frames[0].t : 0;
    var last = this.frames[this.frames.length - 1] || { r: 0, bl: 0 };
    return { magic: MAGIC, formatVersion: FORMAT_VERSION, kind: 'offline', app: 'ZunkoBall',
      appVersion: (window.FH_VERSION || ''), tickRate: TICK_RATE, sampleEvery: SAMPLE_EVERY,
      match: { id: 'off-' + this.startedAt.toString(36), map: this.meta.map, style: this.meta.style,
        scoreLimit: this.meta.scoreLimit | 0, timeLimit: this.meta.timeLimit | 0, mode: 'offline', ranked: false,
        startedAt: this.startedAt, endedAt: Date.now(), end: reason || 'normal' },
      teams: teams, participants: participants, finalScore: { red: last.r | 0, blue: last.bl | 0 },
      durationTicks: dur, durationSec: Math.round(dur / TICK_RATE), roster: this.rosterLog, frames: this.frames, events: this.events };
  };

  var _rec = null;
  var FH_REC = {
    active: function () { return !!_rec; },
    start: function (meta, players) { try { _rec = new Recorder(meta, players); } catch (e) { _rec = null; } },
    tick: function (engine, dt) { if (_rec) try { _rec.tick_(engine, dt); } catch (e) {} },
    cancel: function () { _rec = null; },
    // finaliza, salva na biblioteca local e devolve a promise com o id (ou null)
    finalize: function (reason) {
      var rec = _rec; _rec = null;
      if (!rec || rec.frames.length < 2) return Promise.resolve(null);
      var dur = rec.frames[rec.frames.length - 1].t - rec.frames[0].t;
      if (dur < TICK_RATE * 6) return Promise.resolve(null);   // partida curta demais
      var obj = rec.build(reason);
      try { obj._size = JSON.stringify(obj).length; } catch (e) { obj._size = 0; }
      obj.id = obj.match.id; obj.savedAt = Date.now(); obj.durationSec = obj.durationSec;
      return FH_LIB.put(obj).then(function () { return obj.id; }).catch(function () { return null; });
    }
  };
  window.FH_REC = FH_REC;

  /* ====================== player ====================== */
  function rosterAt(obj, tick) {
    var log = obj.roster || [], best = log.length ? log[0].slots : {};
    for (var i = 0; i < log.length; i++) { if (log[i].tick <= tick) best = log[i].slots; else break; }
    return best || {};
  }
  function frameIndexAt(frames, tick) {
    var lo = 0, hi = frames.length - 1;
    if (tick <= frames[0].t) return 0;
    if (tick >= frames[hi].t) return hi;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (frames[mid].t <= tick) lo = mid; else hi = mid - 1; }
    return lo;
  }
  function clk(sec) { sec = Math.max(0, Math.floor(sec)); var m = Math.floor(sec / 60), r = sec % 60; return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r; }
  function spdTxt(v) { return String(v).replace('.', ',') + 'x'; }
  function mapLabel(k) { k = String(k || ''); var m = /^v(\d+)$/.exec(k); if (m) return 'Futsal ' + m[1] + 'v' + m[1]; m = /^r(\d+)$/.exec(k); if (m) return 'Real ' + m[1] + 'v' + m[1]; return k || 'Campo'; }
  function mmss(sec) { sec = Math.max(0, Math.floor(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }

  var P = {
    obj: null, stats: null, playing: false, speed: 1, pos: 0, t0: 0, t1: 0, last: 0, evIdx: 0,
    bar: null, ui: null, active: false, SPEEDS: [0.25, 0.5, 1, 1.5, 2, 4],
    cam: { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, tzoom: 1, follow: -1, followBall: false },
    trails: false, panel: null, pointers: {}, dragId: null, dragLast: null, pinchDist: 0
  };

  var ICON_PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
  function syncButtons() {
    if (!P.bar) return;
    P.bar.querySelector('#rpPlay').innerHTML = P.playing ? ICON_PAUSE : ICON_PLAY;
    var cam = P.bar.querySelector('#rpCam'); if (cam) cam.classList.toggle('on', P.cam.followBall || P.cam.follow >= 0);
    var tac = P.bar.querySelector('#rpTac'); if (tac) tac.classList.toggle('on', P.trails);
    pokeBar(true);
  }

  /* ---- barra compacta: some sozinha enquanto reproduz (toque/mouse/tecla traz de volta) ---- */
  function pokeBar(force) {
    var b = P.bar; if (!b) return;
    var now = Date.now(); if (!force && P._lastPoke && now - P._lastPoke < 250 && !b.classList.contains('rpHide')) return;
    P._lastPoke = now;
    b.classList.remove('rpHide'); clearTimeout(P._hideT);
    var busy = function () { return !P.playing || b.classList.contains('moreOpen') || (P.drawer && P.drawer.classList.contains('open')); };
    if (!busy()) P._hideT = setTimeout(function () { if (P.active && P.bar && !busy()) P.bar.classList.add('rpHide'); }, 3500);
  }
  function buildInfo(obj) {          // caixinha do canto: times e modalidade
    var g = document.getElementById('game'); if (!g) return;
    var el = P.info; if (!el) { el = document.createElement('div'); el.className = 'rpInfo'; g.appendChild(el); P.info = el; }
    var t = obj.teams || { red: [], blue: [] }, m = obj.match || {};
    el.textContent = '';
    var add = function (cls, txt) { var d = document.createElement('div'); d.className = cls; d.textContent = txt; el.appendChild(d); };
    add('rpInfoT rpInfoTr', 'VERMELHO'); add('rpInfoN', (t.red || []).join(', ') || '—');
    add('rpInfoT rpInfoTb', 'AZUL'); add('rpInfoN', (t.blue || []).join(', ') || '—');
    add('rpInfoM', ((m.ranked ? 'RANQUEADA' : m.mode === 'offline' ? 'VS IA' : 'SALA') + ' · ' + mapLabel(m.map)).toUpperCase());
  }
  function renderMarks() {          // marcadores de gol na linha do tempo
    var box = P.bar && P.bar.querySelector('#rpMarks'); if (!box) return; box.textContent = '';
    var tl = (P.stats && P.stats.timeline) || [], span = P.t1 - P.t0; if (span <= 0) return;
    tl.forEach(function (t) {
      if (!t.team) return;
      var pct = Math.max(0, Math.min(100, ((t.tick - P.t0) / span) * 100));
      var i = document.createElement('i'); i.className = 'rpMark rp-' + t.team; i.style.left = pct + '%'; i.title = 'Gol ' + mmss(t.elapsedSec);
      box.appendChild(i);
    });
  }

  /* ---- camera helpers (pan/zoom/follow) ---- */
  function fieldSize() { var e = engine, m = e && e.m; return m ? { w: m.PlayerAreaSettings.width, h: m.PlayerAreaSettings.height } : { w: 20, h: 10 }; }
  function camReset() { var f = fieldSize(); P.cam.tx = f.w / 2; P.cam.ty = f.h / 2; P.cam.tzoom = 1; P.cam.follow = -1; P.cam.followBall = false; syncButtons(); }
  function camCenterBall() { P.cam.followBall = true; P.cam.follow = -1; if (P.cam.tzoom < 1.4) P.cam.tzoom = 1.6; syncButtons(); }
  function camFreeNow() { P.cam.follow = -1; P.cam.followBall = false; }
  function screenToWorld(px, py) { var v = engine && engine._view; if (!v) return { x: 0, y: 0 }; return { x: (px - v.ox) / v.scale, y: (py - v.oy) / v.scale }; }
  function setZoomAt(newZoom, px, py) {
    newZoom = Math.max(0.5, Math.min(5, newZoom));
    var before = screenToWorld(px, py);
    P.cam.zoom = P.cam.tzoom = newZoom;
    // reposiciona para manter o ponto sob o cursor (precisa do _view atual)
    var v = engine && engine._view; if (v) { var after = { x: (px - v.ox) / v.scale, y: (py - v.oy) / v.scale }; P.cam.tx += (before.x - after.x); P.cam.ty += (before.y - after.y); P.cam.x = P.cam.tx; P.cam.y = P.cam.ty; }
    camFreeNow();
  }

  function updateCamTargets() {
    if (!engine) return;
    if (P.cam.followBall && engine.ball) { P.cam.tx = engine.ball.x; P.cam.ty = engine.ball.y; }
    else if (P.cam.follow >= 0) {
      for (var i = 0; i < engine.players.length; i++) { if (engine.players[i]._slot === P.cam.follow) { P.cam.tx = engine.players[i].x; P.cam.ty = engine.players[i].y; break; } }
    }
    var k = 0.2;
    P.cam.x += (P.cam.tx - P.cam.x) * k;
    P.cam.y += (P.cam.ty - P.cam.y) * k;
    P.cam.zoom += (P.cam.tzoom - P.cam.zoom) * k;
    engine.replayCam = { active: true, x: P.cam.x, y: P.cam.y, zoom: P.cam.zoom };
  }

  /* overlays taticos: trajetorias + anel de destaque, desenhados sobre o campo */
  function drawOverlays() {
    var e = engine, v = e && e._view, ctx = e && e.ctx; if (!v || !ctx) return;
    var dpr = e.renderDPR || 1;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var toS = function (wx, wy) { return [v.ox + wx * v.scale, v.oy + wy * v.scale]; };
    if (P.trails && P.obj) {
      var frames = P.obj.frames, cur = frameIndexAt(frames, P.pos), back = Math.max(0, cur - 90), paths = {};
      for (var fi = back; fi <= cur; fi++) { var fr = frames[fi]; for (var pi = 0; pi < fr.p.length; pi++) { var pp = fr.p[pi], sl = pp[0]; (paths[sl] = paths[sl] || { team: pp[1], pts: [] }).pts.push([pp[2], pp[3]]); } }
      for (var sk in paths) { if (!paths.hasOwnProperty(sk)) continue; var pa = paths[sk]; if (pa.pts.length < 2) continue; ctx.beginPath(); ctx.lineWidth = 2; ctx.strokeStyle = pa.team === 2 ? 'rgba(80,150,255,.55)' : 'rgba(255,90,90,.55)'; var s0 = toS(pa.pts[0][0], pa.pts[0][1]); ctx.moveTo(s0[0], s0[1]); for (var q = 1; q < pa.pts.length; q++) { var sp = toS(pa.pts[q][0], pa.pts[q][1]); ctx.lineTo(sp[0], sp[1]); } ctx.stroke(); }
      ctx.beginPath(); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,235,120,.85)'; var b0 = toS(frames[back].b[0], frames[back].b[1]); ctx.moveTo(b0[0], b0[1]); for (var bi = back + 1; bi <= cur; bi++) { var bp = toS(frames[bi].b[0], frames[bi].b[1]); ctx.lineTo(bp[0], bp[1]); } ctx.stroke();
    }
    if (P.cam.follow >= 0) {
      for (var i2 = 0; i2 < e.players.length; i2++) { if (e.players[i2]._slot === P.cam.follow) { var ps = toS(e.players[i2].x, e.players[i2].y); ctx.beginPath(); ctx.arc(ps[0], ps[1], 0.95 * v.scale, 0, Math.PI * 2); ctx.lineWidth = 3; ctx.strokeStyle = '#ffd54a'; ctx.stroke(); break; } }
    }
    ctx.restore();
  }

  function fireEventsUpTo(pos) {
    var evs = P.obj.events;
    while (P.evIdx < evs.length && evs[P.evIdx][1] <= pos) {
      var ev = evs[P.evIdx++];
      try {
        if (ev[0] === EV.KICK) { if (typeof play === 'function') play('sound/kick_ball.mp3'); }
        else if (ev[0] === EV.GOAL) { if (typeof playGoalCue === 'function') playGoalCue(); }
      } catch (er) {}
    }
  }

  function updateBarTime(pos) {
    if (!P.bar) return;
    P.bar.querySelector('#rpCur').textContent = clk((pos - P.t0) / TICK_RATE);
    var seek = P.bar.querySelector('#rpSeek'); if (seek && !P._seekDrag) { seek.value = Math.round((P.t1 > P.t0 ? (pos - P.t0) / (P.t1 - P.t0) : 0) * 1000); seek.style.setProperty('--p', (seek.value / 10) + '%'); }
  }

  function renderAt(pos) {
    var obj = P.obj, frames = obj.frames, e = engine; if (!e) return;
    var ai = frameIndexAt(frames, pos), A = frames[ai], B = frames[Math.min(ai + 1, frames.length - 1)];
    var span = (B.t - A.t) || 1, a = Math.max(0, Math.min(1, (pos - A.t) / span));
    var rs = rosterAt(obj, A.t), bmap = {};
    for (var j = 0; j < B.p.length; j++) bmap[B.p[j][0]] = B.p[j];
    var list = [];
    for (var i = 0; i < A.p.length; i++) {
      var pa = A.p[i], slot = pa[0], pb = bmap[slot] || pa, info = rs[slot] || {};
      list.push({ _slot: slot, team: teamStr(pa[1]), x: pa[2] + (pb[2] - pa[2]) * a, y: pa[3] + (pb[3] - pa[3]) * a,
        vx: pa[4], vy: pa[5], r: 0.68, mass: 1, nick: info.nick || '', avatar: info.av || '' });
    }
    e.players = list;
    e.ball.x = A.b[0] + (B.b[0] - A.b[0]) * a; e.ball.y = A.b[1] + (B.b[1] - A.b[1]) * a;
    e.ball.vx = A.b[2]; e.ball.vy = A.b[3];
    e.red = A.r; e.blue = A.bl; e.time = Math.max(0, A.tt / TICK_RATE);
    e.running = A.ph !== PH.ENDED;
    if (A.ph === PH.GOAL) { var sc = A.ls >= 0 ? rs[A.ls] : null; e.goalAnim = { team: A.gtm === 2 ? 'blue' : 'red', scorerName: sc ? sc.nick : '', t: A.gt / TICK_RATE }; }
    else e.goalAnim = null;
    if (A.rs && A.ph === PH.PLAY) { var ty = A.rs.type; e.restart = { type: ty === 1 ? 'throw' : ty === 2 ? 'goalkick' : 'corner', team: A.rs.team === 1 ? 'red' : 'blue', x: A.rs.x, y: A.rs.y, t: A.rs.t }; }
    else e.restart = null;
    updateCamTargets();
    try { updateGoalNets(1 / 60); } catch (er) {}
    try { draw(); } catch (er) {}
    try { drawOverlays(); } catch (er) {}
    updateBarTime(pos);
  }

  /* ---- navegacao por gols ---- */
  function goalTicks() { return (P.obj.events || []).filter(function (e) { return e[0] === EV.GOAL; }).map(function (e) { return e[1] | 0; }).sort(function (a, b) { return a - b; }); }
  function seekTo(tick) {
    P.pos = Math.max(P.t0, Math.min(P.t1, tick));
    P.evIdx = 0; while (P.evIdx < P.obj.events.length && P.obj.events[P.evIdx][1] <= P.pos) P.evIdx++;
    renderAt(P.pos);
  }
  function nextGoal(dir) {
    var gs = goalTicks(), target = null, ref = P.pos + dir * 2; // margem p/ nao travar no mesmo gol
    if (dir > 0) { for (var i = 0; i < gs.length; i++) if (gs[i] > ref) { target = gs[i] - 3 * TICK_RATE; break; } }
    else { for (var j = gs.length - 1; j >= 0; j--) if (gs[j] < ref) { target = gs[j] - 3 * TICK_RATE; break; } }
    if (target != null) seekTo(target);
  }
  function skip(sec) { seekTo(P.pos + sec * TICK_RATE); }
  function togglePlay() { if (P.pos >= P.t1) { P.pos = P.t0; P.evIdx = 0; } P.playing = !P.playing; syncButtons(); }
  function syncSpeed() {
    if (!P.bar) return;
    var sp = P.bar.querySelector('#rpSpeed'); if (sp) sp.textContent = spdTxt(P.speed);
    P.bar.querySelectorAll('.rpChip').forEach(function (c) { c.classList.toggle('on', Math.abs(parseFloat(c.getAttribute('data-speed')) - P.speed) < 1e-6); });
  }
  function setSpeed(v) { P.speed = v; syncSpeed(); }
  function cycleSpeed() { var i = P.SPEEDS.indexOf(P.speed); setSpeed(P.SPEEDS[(i + 1) % P.SPEEDS.length]); }

  function buildBar() {
    if (P.bar) return P.bar;
    var g = document.getElementById('game'); if (!g) return null;
    var bar = document.createElement('div'); bar.id = 'replayBar'; bar.className = 'replayBar';
    var chips = [0.25, 0.5, 1, 2, 4].map(function (v) { return '<button type="button" class="rpB rpChip" data-speed="' + v + '" title="Velocidade ' + spdTxt(v) + '">' + spdTxt(v) + '</button>'; }).join('');
    bar.innerHTML =
      '<div class="rpRow">' +
        '<div class="rpGrp rpL">' +
          '<button type="button" id="rpRestart" class="rpB rpIcon" title="Voltar ao início" aria-label="Voltar ao início"><svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>' +
          '<button type="button" id="rpBack" class="rpB" title="Voltar 10s" aria-label="Voltar 10 segundos">&minus;10s</button>' +
          '<button type="button" id="rpPlay" class="rpB rpPlay" title="Reproduzir/Pausar" aria-label="Reproduzir ou pausar"></button>' +
          '<button type="button" id="rpFwd" class="rpB" title="Avançar 10s" aria-label="Avançar 10 segundos">+10s</button>' +
          '<span class="rpClock"><b id="rpCur">00:00</b> / <span id="rpDur">00:00</span></span>' +
        '</div>' +
        '<div class="rpGrp rpR">' +
          '<div class="rpChips">' + chips + '</div>' +
          '<button type="button" id="rpSpeed" class="rpB rpSpd" title="Velocidade" aria-label="Velocidade">1x</button>' +
          '<button type="button" id="rpMore" class="rpB rpIcon" title="Mais ferramentas" aria-label="Mais ferramentas"><svg viewBox="0 0 24 24"><path d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/></svg></button>' +
          '<button type="button" id="rpExit" class="rpB rpExit" title="Sair do replay (Esc)" aria-label="Sair do replay">&#10005; Sair</button>' +
        '</div>' +
      '</div>' +
      '<div class="rpSeekRow"><div class="rpSeekWrap"><input id="rpSeek" class="rpSeek" type="range" min="0" max="1000" value="0" step="1" aria-label="Linha do tempo"><span id="rpMarks" class="rpMarks"></span></div></div>' +
      '<div class="rpTools" id="rpTools">' +
        tbtn('rpPrevGoal', 'Gol ant.', 'M6 6h2v12H6zm3.5 6l8.5 6V6z') +
        tbtn('rpNextGoal', 'Próx. gol', 'M16 6h2v12h-2zM6 18l8.5-6L6 6z') +
        tbtn('rpCam', 'Seguir bola', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm9 3a9 9 0 1 1-18 0 9 9 0 0 1 18 0zm-2 0a7 7 0 1 0-14 0 7 7 0 0 0 14 0z') +
        tbtn('rpTac', 'Tático', 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z') +
        tbtn('rpFit', 'Centralizar', 'M3 5h2V3H3zm0 16h2v-2H3zm16 0h2v-2h-2zM19 3v2h2V3zM7 12l5-5 5 5-2 2-3-3-3 3z') +
        tbtn('rpZoomOut', 'Zoom −', 'M19 13H5v-2h14z') +
        tbtn('rpZoomIn', 'Zoom +', 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z') +
        tbtn('rpStats', 'Resumo', 'M5 9h3v10H5zm5-6h3v16h-3zm5 9h3v7h-3z') +
        tbtn('rpShare', 'Exportar', 'M18 16a3 3 0 0 0-2.3 1.1l-7-4a3 3 0 0 0 0-2.2l7-4A3 3 0 1 0 15 5l-7 4a3 3 0 1 0 0 6l7 4a3 3 0 1 0 3-3z') +
      '</div>';
    g.appendChild(bar); P.bar = bar;
    var on = function (id, fn) { var el = bar.querySelector('#' + id); if (el) el.onclick = fn; };
    on('rpExit', function () { FH_REPLAY.close(); });
    on('rpRestart', function () { P.pos = P.t0; P.evIdx = 0; P.playing = true; syncButtons(); });
    on('rpPlay', togglePlay);
    on('rpBack', function () { skip(-10); });
    on('rpFwd', function () { skip(10); });
    on('rpPrevGoal', function () { nextGoal(-1); });
    on('rpNextGoal', function () { nextGoal(1); });
    on('rpSpeed', cycleSpeed);
    bar.querySelectorAll('.rpChip').forEach(function (c) { c.onclick = function () { setSpeed(parseFloat(c.getAttribute('data-speed'))); pokeBar(true); }; });
    on('rpCam', function () { if (P.cam.followBall) camReset(); else camCenterBall(); });
    on('rpTac', function () { P.trails = !P.trails; syncButtons(); renderAt(P.pos); });
    on('rpZoomIn', function () { P.cam.tzoom = Math.min(5, P.cam.tzoom * 1.25); });
    on('rpZoomOut', function () { P.cam.tzoom = Math.max(0.5, P.cam.tzoom / 1.25); });
    on('rpFit', camReset);
    on('rpStats', function () { togglePanel('stats'); });
    on('rpShare', function () { togglePanel('share'); });
    on('rpMore', function () { bar.classList.toggle('moreOpen'); var mb = bar.querySelector('#rpMore'); if (mb) mb.classList.toggle('on', bar.classList.contains('moreOpen')); pokeBar(true); });
    ['pointerdown', 'pointermove', 'keydown'].forEach(function (ev) { g.addEventListener(ev, function () { pokeBar(); }, { passive: true }); });
    var seek = bar.querySelector('#rpSeek');
    seek.oninput = function () { seek.style.setProperty('--p', (seek.value / 10) + '%'); P.pos = P.t0 + ((+seek.value) / 1000) * (P.t1 - P.t0); P.evIdx = 0; while (P.evIdx < P.obj.events.length && P.obj.events[P.evIdx][1] <= P.pos) P.evIdx++; renderAt(P.pos); };
    seek.onpointerdown = function () { P._seekDrag = true; P._wasPlaying = P.playing; P.playing = false; syncButtons(); };
    seek.onpointerup = function () { P._seekDrag = false; if (P._wasPlaying) { P.playing = true; syncButtons(); } };
    return bar;
  }
  function tbtn(id, label, path) { return '<button type="button" id="' + id + '" class="rpTool" title="' + label + '" aria-label="' + label + '"><svg viewBox="0 0 24 24"><path d="' + path + '"/></svg><span>' + label + '</span></button>'; }
  function btn(id, title, path) { return '<button type="button" id="' + id + '" class="rpBtn" title="' + title + '" aria-label="' + title + '"><svg viewBox="0 0 24 24"><path d="' + path + '"/></svg></button>'; }

  /* ---- gestos no canvas: arrastar (pan), roda/pinca (zoom) ---- */
  function bindCanvas() {
    var c = document.getElementById('canvas'); if (!c || c._rpBound) return; c._rpBound = true;
    c.addEventListener('pointerdown', function (ev) {
      if (!P.active) return; P.pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      try { c.setPointerCapture(ev.pointerId); } catch (e) {}
      var ids = Object.keys(P.pointers);
      if (ids.length === 1) { P.dragId = ev.pointerId; P.dragLast = { x: ev.clientX, y: ev.clientY }; camFreeNow(); }
      else if (ids.length === 2) { P.pinchDist = pinchDistance(); }
    });
    c.addEventListener('pointermove', function (ev) {
      if (!P.active || !P.pointers[ev.pointerId]) return;
      P.pointers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      var ids = Object.keys(P.pointers);
      if (ids.length >= 2) {
        var d = pinchDistance(); if (P.pinchDist > 0 && d > 0) { var mid = pinchMid(); setZoomAt(P.cam.tzoom * (d / P.pinchDist), mid.x, mid.y); } P.pinchDist = d;
      } else if (ev.pointerId === P.dragId && P.dragLast) {
        var v = engine && engine._view; if (v) { P.cam.tx -= (ev.clientX - P.dragLast.x) / v.scale; P.cam.ty -= (ev.clientY - P.dragLast.y) / v.scale; P.cam.x = P.cam.tx; P.cam.y = P.cam.ty; }
        P.dragLast = { x: ev.clientX, y: ev.clientY };
      }
    });
    var up = function (ev) { delete P.pointers[ev.pointerId]; if (ev.pointerId === P.dragId) { P.dragId = null; P.dragLast = null; } if (Object.keys(P.pointers).length < 2) P.pinchDist = 0; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', function (ev) { if (!P.active) return; ev.preventDefault(); setZoomAt(P.cam.tzoom * (ev.deltaY < 0 ? 1.12 : 1 / 1.12), ev.clientX, ev.clientY); }, { passive: false });
    c.addEventListener('dblclick', function (ev) { if (!P.active) return; camReset(); });
  }
  function pinchDistance() { var k = Object.keys(P.pointers); if (k.length < 2) return 0; var a = P.pointers[k[0]], b = P.pointers[k[1]]; return Math.hypot(a.x - b.x, a.y - b.y); }
  function pinchMid() { var k = Object.keys(P.pointers); var a = P.pointers[k[0]], b = P.pointers[k[1]]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  /* ---- atalhos de teclado ---- */
  function onKey(ev) {
    if (!P.active) return;
    var k = ev.key;
    if (k === ' ') { ev.preventDefault(); togglePlay(); }
    else if (k === 'ArrowLeft') { skip(ev.shiftKey ? -1 : -5); }
    else if (k === 'ArrowRight') { skip(ev.shiftKey ? 1 : 5); }
    else if (k === 'ArrowUp') cycleSpeed();
    else if (k === 'r' || k === 'R') { P.pos = P.t0; P.evIdx = 0; P.playing = true; syncButtons(); }
    else if (k === 'f' || k === 'F') { if (P.cam.followBall) camReset(); else camCenterBall(); }
    else if (k === 't' || k === 'T') { P.trails = !P.trails; syncButtons(); renderAt(P.pos); }
    else if (k === 'g' || k === 'G') { nextGoal(ev.shiftKey ? -1 : 1); }
    else if (k === '+' || k === '=') { P.cam.tzoom = Math.min(5, P.cam.tzoom * 1.2); }
    else if (k === '-' || k === '_') { P.cam.tzoom = Math.max(0.5, P.cam.tzoom / 1.2); }
    else if (k === 'Escape') FH_REPLAY.close();
    else if (k === '.') { P.playing = false; syncButtons(); skip(1 / TICK_RATE); }
    else if (k === ',') { P.playing = false; syncButtons(); skip(-1 / TICK_RATE); }
  }

  /* ---- painel lateral: estatisticas, jogadores, gols, exportar ---- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function togglePanel(which, forceOpen) {
    var d = P.drawer || buildDrawer(); if (!d) return;
    var open = forceOpen != null ? forceOpen : !d.classList.contains('open');
    d.classList.toggle('open', open);
    if (P.bar) { P.bar.classList.toggle('withDrawer', open); P.bar.classList.remove('moreOpen'); }
    pokeBar(true);
    if (open) { renderDrawer(); if (which === 'share') { var ex = d.querySelector('#rpExport'); if (ex) ex.scrollIntoView({ block: 'nearest' }); } }
  }
  function buildDrawer() {
    if (P.drawer) return P.drawer;
    var g = document.getElementById('game'); if (!g) return null;
    var d = document.createElement('div'); d.id = 'rpDrawer'; d.className = 'rpDrawer';
    d.innerHTML = '<div class="rpDrawerHead"><strong>Resumo da partida</strong><button type="button" id="rpDrawerClose" class="rpBtn" title="Fechar" aria-label="Fechar"><svg viewBox="0 0 24 24"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg></button></div><div id="rpDrawerBody" class="rpDrawerBody"></div>';
    g.appendChild(d); P.drawer = d;
    d.querySelector('#rpDrawerClose').onclick = function () { togglePanel('stats', false); };
    return d;
  }
  function bar2(leftPct, lbl) { leftPct = Math.max(0, Math.min(100, leftPct | 0)); return '<div class="rpPoss"><div class="rpPossBar"><span class="rpPossR" style="width:' + leftPct + '%"></span><span class="rpPossB" style="width:' + (100 - leftPct) + '%"></span></div><div class="rpPossLbl">' + lbl + '</div></div>'; }
  function renderDrawer() {
    var d = P.drawer, s = P.stats; if (!d || !s) return;
    var body = d.querySelector('#rpDrawerBody'), h = '';
    // placar
    h += '<div class="rpScore"><span class="rpScoreR">' + s.finalScore.red + '</span><span class="rpScoreX">x</span><span class="rpScoreB">' + s.finalScore.blue + '</span></div>';
    h += '<div class="rpDur">Duracao: ' + mmss(s.durationSec) + '</div>';
    // posse
    h += '<h4>Posse de bola</h4>';
    if (s.available.possession && s.possession) h += bar2(s.possession.redPct, 'Vermelho ' + s.possession.redPct + '% &middot; Azul ' + s.possession.bluePct + '% <span class="rpEst">(estimada)</span>');
    else h += '<p class="rpNa">Nao disponivel. ' + esc(s.available.possessionReason || '') + '</p>';
    // finalizacoes
    h += '<h4>Finalizacoes</h4><p class="rpNa">Nao disponivel. ' + esc(s.available.shotsReason) + '</p>';
    // jogadores
    h += '<h4>Jogadores</h4>';
    h += '<table class="rpTbl"><thead><tr><th>Jogador</th><th>G</th><th>A</th><th>Toques</th><th>Tempo</th></tr></thead><tbody>';
    s.players.forEach(function (p) {
      var na = '<span class="rpNa">-</span>';
      h += '<tr class="rp-' + p.team + '"><td><button type="button" class="rpFollow" data-slot="' + p.slot + '"><span class="rpDot"></span>' + esc(p.nick || ('#' + p.slot)) + '</button></td>' +
        '<td>' + (p.goals == null ? na : p.goals) + '</td>' +
        '<td>' + (p.assists == null ? na : p.assists) + '</td>' +
        '<td>' + (p.touches == null ? na : p.touches) + '</td>' +
        '<td>' + mmss(p.playedSec) + '</td></tr>';
    });
    h += '</tbody></table>';
    if (!s.available.goalsPerPlayer) h += '<p class="rpNa">Gols/assistencias por jogador nao disponiveis neste replay (ex.: partida offline).</p>';
    else h += '<p class="rpEst">G = gols, A = assistencias (estimadas), Toques = chutes na bola.</p>';
    // gols / timeline
    h += '<h4>Gols e momentos</h4>';
    if (s.timeline.length) { h += '<ul class="rpTimeline">'; s.timeline.forEach(function (t) { h += '<li class="rp-' + (t.team || 'n') + '"><button type="button" class="rpJump" data-tick="' + t.tick + '"><span class="rpTl">' + mmss(t.elapsedSec) + '</span> ' + esc(t.label) + '</button></li>'; }); h += '</ul>'; }
    else h += '<p class="rpNa">Sem gols registrados.</p>';
    // export
    h += '<div id="rpExport"><h4>Exportar / compartilhar</h4>' +
      '<button type="button" id="rpDl" class="rpTextBtn rpPrimary">Baixar replay (.fhreplay)</button>' +
      '<button type="button" id="rpCopy" class="rpTextBtn">Copiar resumo</button>' +
      '<button type="button" id="rpShareBtn" class="rpTextBtn">Compartilhar</button></div>';
    body.innerHTML = h;
    body.querySelectorAll('.rpFollow').forEach(function (bn) { bn.onclick = function () { var sl = +bn.getAttribute('data-slot'); P.cam.follow = (P.cam.follow === sl ? -1 : sl); P.cam.followBall = false; if (P.cam.follow >= 0 && P.cam.tzoom < 1.4) P.cam.tzoom = 1.8; syncButtons(); }; });
    body.querySelectorAll('.rpJump').forEach(function (bn) { bn.onclick = function () { seekTo((+bn.getAttribute('data-tick')) - 3 * TICK_RATE); }; });
    var dl = body.querySelector('#rpDl'); if (dl) dl.onclick = downloadReplay;
    var cp = body.querySelector('#rpCopy'); if (cp) cp.onclick = copySummary;
    var sh = body.querySelector('#rpShareBtn'); if (sh) sh.onclick = shareSummary;
  }

  function summaryText() {
    var s = P.stats, m = P.obj.match || {}, L = [];
    L.push('ZunkoBall - Replay');
    L.push('Placar: Vermelho ' + s.finalScore.red + ' x ' + s.finalScore.blue + ' Azul');
    L.push('Duracao: ' + mmss(s.durationSec));
    if (s.available.possession && s.possession) L.push('Posse (estimada): Vermelho ' + s.possession.redPct + '% / Azul ' + s.possession.bluePct + '%');
    if (s.goals.length) { L.push('Gols:'); s.goals.forEach(function (g) { L.push('  ' + mmss(g.elapsedSec) + ' - ' + (g.team === 'blue' ? 'Azul' : 'Vermelho') + (g.scorerName ? ' (' + g.scorerName + (g.assistName ? ', assist. ' + g.assistName : '') + ')' : '') + ' [' + g.redScore + 'x' + g.blueScore + ']'); }); }
    return L.join('\n');
  }
  function downloadReplay() {
    try {
      var blob = new Blob([JSON.stringify(P.obj)], { type: 'application/json' });
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      var nm = (P.obj.match && (P.obj.match.id || P.obj.match.map)) || 'partida';
      a.href = url; a.download = 'zunkoball-' + String(nm).replace(/[^\w.-]+/g, '_') + '.fhreplay';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) { if (typeof toast === 'function') toast('Nao foi possivel baixar o replay.'); }
  }
  function copySummary() {
    var txt = summaryText();
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(function () { if (typeof toast === 'function') toast('Resumo copiado!'); }); return; } } catch (e) {}
    try { var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); if (typeof toast === 'function') toast('Resumo copiado!'); } catch (e2) {}
  }
  function shareSummary() {
    var txt = summaryText();
    if (navigator.share) { navigator.share({ title: 'ZunkoBall - Replay', text: txt }).catch(function () {}); }
    else copySummary();
  }

  var FH_REPLAY = {
    isActive: function () { return P.active; },
    frame: function (now) {
      if (!P.active || !P.obj) return;
      var dtMs = Math.min(100, now - P.last); P.last = now;
      if (P.playing) {
        var prev = P.pos;
        P.pos += (dtMs / 1000) * TICK_RATE * P.speed;
        if (P.pos >= P.t1) { P.pos = P.t1; P.playing = false; syncButtons(); }
        fireEventsUpTo(P.pos);
        if (P.pos < prev) P.evIdx = 0;
      }
      renderAt(P.pos);
    },
    open: function (obj) {
      var err = validate(obj); if (err) { if (typeof toast === 'function') toast(err); return false; }
      if (typeof stop === 'function') stop();
      P.obj = obj; P.frames = obj.frames;
      P.t0 = obj.frames[0].t; P.t1 = obj.frames[obj.frames.length - 1].t;
      P.pos = P.t0; P.evIdx = 0; P.speed = 1; P.playing = true; P.active = true; P.last = performance.now();
      P.trails = false;
      try { P.stats = window.FH_STATS ? window.FH_STATS.compute(obj) : null; } catch (e) { P.stats = null; }
      var mapKey = (MAPS[obj.match.map] ? obj.match.map : 'v3');
      var c = document.getElementById('canvas'), m = MAPS[mapKey] || MAPS.classic, ctx = c.getContext('2d', { alpha: false });
      mode = 'online'; spectatorMode = true;
      engine = { c: c, ctx: ctx, m: m, replay: true, running: true, paused: false, last: performance.now(),
        time: 0, red: 0, blue: 0, kickFlash: 0, passFlash: 0, goalAnim: null, restart: null, keys: new Set(),
        touch: { x: 0, y: 0, active: false }, players: [],
        ball: { x: m.PlayerAreaSettings.width / 2, y: m.PlayerAreaSettings.height / 2, vx: 0, vy: 0, r: m.BallProperty.radius * 1.28, mass: m.BallProperty.density, angle: 0 } };
      P.cam = { x: m.PlayerAreaSettings.width / 2, y: m.PlayerAreaSettings.height / 2, zoom: 1,
        tx: m.PlayerAreaSettings.width / 2, ty: m.PlayerAreaSettings.height / 2, tzoom: 1, follow: -1, followBall: false };
      engine.replayCam = { active: true, x: P.cam.x, y: P.cam.y, zoom: 1 };
      if (typeof show === 'function') show('game');
      document.getElementById('game').classList.add('replayMode', 'spectatorMode');
      buildBar(); buildDrawer(); bindCanvas();
      document.addEventListener('keydown', onKey);
      syncButtons();
      syncSpeed();
      P.bar.querySelector('#rpDur').textContent = clk((P.t1 - P.t0) / TICK_RATE);
      renderMarks(); buildInfo(obj); P.bar.classList.remove('moreOpen', 'withDrawer');
      if (typeof resize === 'function') resize();
      renderAt(P.pos);
      requestAnimationFrame(loop);
      return true;
    },
    close: function () {
      P.active = false; P.playing = false; P.obj = null;
      clearTimeout(P._hideT); if (P.bar) P.bar.classList.remove('rpHide', 'moreOpen', 'withDrawer');
      document.removeEventListener('keydown', onKey);
      if (engine) engine.replayCam = null;
      if (P.drawer) P.drawer.classList.remove('open');
      var g = document.getElementById('game'); if (g) g.classList.remove('replayMode', 'spectatorMode');
      spectatorMode = false;
      if (typeof stop === 'function') stop();
      if (window.FH_REPLAYS) FH_REPLAYS.show(); else if (typeof show === 'function') show('lobbyScreen');
    }
  };
  window.FH_REPLAY = FH_REPLAY;

  /* ====================== tela Replays ====================== */
  function api(path, method) {
    return fetch(path, { method: method || 'GET', credentials: 'same-origin' }).then(function (r) {
      if (path.indexOf('/file') >= 0 && r.ok) return r.json();
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Erro de rede.'); return j; });
    });
  }
  function fmtDate(ts) { try { return new Date(ts).toLocaleString('pt-BR'); } catch (e) { return ''; } }
  function downloadObj(obj, name) {
    try {
      var clean = JSON.parse(JSON.stringify(obj)); delete clean._size; delete clean.savedAt;
      var blob = new Blob([JSON.stringify(clean)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = (name || 'partida') + '.fhreplay'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    } catch (e) {}
  }

  var FH_REPLAYS = {
    show: function () { if (typeof show === 'function') show('replaysScreen'); FH_REPLAYS.refresh(); },
    refresh: function () {
      var list = document.getElementById('replaysList'); if (!list) return;
      LS.seq++; var my = LS.seq;
      list.textContent = ''; list.appendChild(mk('div', 'rpLoading', 'Carregando…'));
      var load;
      if (LS.tab === 'acc') {
        load = fetch('/api/replays', { credentials: 'same-origin' }).then(function (r) {
          if (r.status === 401) return { state: 'login', items: [] };
          return r.json().then(function (j) { return { state: 'ok', items: (j.replays || []).map(function (m) { m.source = 'online'; return m; }) }; });
        }).catch(function () { return { state: 'error', items: [] }; });
      } else {
        load = FH_LIB.list().then(function (items) { return { state: 'ok', items: items || [] }; });
      }
      load.then(function (res) { if (my !== LS.seq) return; LS.state = res.state; LS.items = res.items; fillModes(); renderList(); });
    },
    importFile: function (file) {
      if (!file) return;
      var fr = new FileReader();
      fr.onload = function () {
        var obj; try { obj = JSON.parse(fr.result); } catch (e) { return toastX('Arquivo inválido.'); }
        var err = validate(obj); if (err) return toastX(err);
        try { obj._size = fr.result.length; } catch (e) {}
        obj.id = obj.match && obj.match.id ? obj.match.id : ('imp-' + Date.now().toString(36));
        obj.savedAt = Date.now();
        FH_LIB.put(obj).then(function () { toastX('Replay importado.'); setTab('dev'); }).catch(function () { toastX('Falha ao importar.'); });
      };
      fr.readAsText(file);
    }
  };
  function toastX(m) { try { if (typeof homeToast === 'function') homeToast(m); } catch (e) {} }
  function mk(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  /* ---- lista: abas (Minha conta / Neste dispositivo) + filtros ---- */
  var LS = { tab: 'acc', items: [], state: 'ok', seq: 0 };
  function $i(id) { return document.getElementById(id); }
  function fillModes() {
    var sel = $i('rpMode'); if (!sel) return; var cur = sel.value, seen = {};
    sel.textContent = ''; var o = document.createElement('option'); o.value = ''; o.textContent = 'Todas as modalidades'; sel.appendChild(o);
    LS.items.forEach(function (m) { var k = m.map || ''; if (k && !seen[k]) { seen[k] = 1; } });
    Object.keys(seen).sort().forEach(function (k) { var op = document.createElement('option'); op.value = k; op.textContent = mapLabel(k); sel.appendChild(op); });
    sel.value = seen[cur] ? cur : '';
  }
  function filtered() {
    var q = ($i('rpQ') && $i('rpQ').value || '').trim().toLowerCase(), pl = ($i('rpPlayer') && $i('rpPlayer').value || '').trim().toLowerCase();
    var mode = $i('rpMode') ? $i('rpMode').value : '', date = $i('rpDate') ? $i('rpDate').value : '', sort = $i('rpSort') ? $i('rpSort').value : 'new';
    var now = Date.now(), day = 864e5, start = new Date(); start.setHours(0, 0, 0, 0);
    var out = LS.items.filter(function (m) {
      var names = ((m.teams && m.teams.red) || []).concat((m.teams && m.teams.blue) || []).join(' ').toLowerCase();
      var ts = m.createdAt || m.endedAt || 0;
      if (mode && m.map !== mode) return false;
      if (pl && names.indexOf(pl) < 0) return false;
      if (date === 'today' && ts < start.getTime()) return false;
      if ((date === '7' || date === '30') && ts < now - (+date) * day) return false;
      if (q) { var hay = (names + ' ' + mapLabel(m.map) + ' ' + (m.ranked ? 'ranqueada' : '') + ' ' + (m.mode || '') + ' ' + fmtDate(ts)).toLowerCase(); if (hay.indexOf(q) < 0) return false; }
      return true;
    });
    var ts = function (m) { return m.createdAt || m.endedAt || 0; }, goals = function (m) { var f = m.finalScore || {}; return (f.red | 0) + (f.blue | 0); };
    out.sort(function (a, b) {
      if (sort === 'old') return ts(a) - ts(b);
      if (sort === 'long') return (b.durationSec || 0) - (a.durationSec || 0);
      if (sort === 'goals') return goals(b) - goals(a) || ts(b) - ts(a);
      return ts(b) - ts(a);
    });
    return out;
  }
  function renderList() {
    var list = $i('replaysList'); if (!list) return; list.textContent = '';
    var msg = function (t) { list.appendChild(mk('div', 'rpEmpty', t)); };
    if (LS.tab === 'acc' && LS.state === 'login') return msg('Entre com sua conta para ver os replays guardados online. Replays importados ficam em “Neste dispositivo”.');
    if (LS.state === 'error') return msg('Não foi possível carregar os replays online. Tente novamente em instantes.');
    if (!LS.items.length) return msg(LS.tab === 'acc' ? 'Nenhuma gravação ainda. Jogue uma partida online para começar.' : 'Nenhum replay neste dispositivo. Use “Importar” para abrir um arquivo .fhreplay.');
    var items = filtered();
    if (!items.length) return msg('Nenhum replay encontrado com esses filtros.');
    items.forEach(function (m) { list.appendChild(card(m)); });
  }
  function setTab(t) {
    LS.tab = t;
    [['rpTabAcc', 'acc'], ['rpTabDev', 'dev']].forEach(function (x) { var b = $i(x[0]); if (b) { b.classList.toggle('on', x[1] === t); b.setAttribute('aria-selected', x[1] === t ? 'true' : 'false'); } });
    FH_REPLAYS.refresh();
  }

  /* bonecos (avatares) de cada time: vermelho à esquerda, azul à direita; times grandes viram "+N" */
  function avText(p) { var t = Array.from(String(p.avatar || '')).slice(0, 2).join(''); if (!t) t = Array.from(String(p.nick || '?')).slice(0, 2).join(''); return t.toUpperCase(); }
  function playersOf(m, side) {
    if (m.players && m.players.length) return m.players.filter(function (p) { return p.team === side; });
    return ((m.teams && m.teams[side]) || []).map(function (n) { return { nick: n, avatar: '', team: side }; });     // replays antigos: só os nomes
  }
  function avStack(m, side) {
    var list = playersOf(m, side), MAX = 5, cls = side === 'red' ? 'rpAvR' : 'rpAvB';
    var box = mk('div', 'rpAvs ' + (side === 'red' ? 'rpSideR' : 'rpSideB'));
    box.title = (side === 'red' ? 'Vermelho: ' : 'Azul: ') + (list.map(function (p) { return p.nick; }).join(', ') || '—');
    var disks = mk('span', 'rpDisks');
    list.slice(0, MAX).forEach(function (p) { var a = mk('span', 'rpAv ' + cls, avText(p)); a.title = p.nick || ''; disks.appendChild(a); });
    if (list.length > MAX) disks.appendChild(mk('span', 'rpAv rpAvMore', '+' + (list.length - MAX)));
    if (!list.length) disks.appendChild(mk('span', 'rpAv ' + cls, '?'));
    box.appendChild(disks);
    if (list.length === 1 && list[0].nick) box.appendChild(mk('span', 'rpAvName', list[0].nick));      // 1x1: mostra o nome ao lado do boneco
    return box;
  }
  function card(m) {
    var fs = m.finalScore || { red: 0, blue: 0 };
    var c = mk('div', 'rpCard' + (m.source === 'online' ? ' online' : ' local'));
    var meta = mk('div', 'rpMetaCol');
    var line = mk('div', 'rpTagLine');
    line.appendChild(mk('span', 'rpTag', m.source === 'online' ? 'ONLINE' : (m.mode === 'offline' ? 'VS IA' : 'LOCAL')));
    line.appendChild(mk('span', 'rpMap', mapLabel(m.map) + (m.ranked ? ' • Ranqueada' : '')));
    meta.appendChild(line);
    meta.appendChild(mk('div', 'rpMeta', fmtDate(m.createdAt || m.endedAt) + '  •  ' + mmss(m.durationSec || 0)));
    c.appendChild(meta);
    var vs = mk('div', 'rpVs');
    vs.appendChild(avStack(m, 'red'));
    vs.appendChild(mk('span', 'rpNum', (fs.red | 0) + ' – ' + (fs.blue | 0)));
    vs.appendChild(avStack(m, 'blue'));
    c.appendChild(vs);
    var acts = mk('div', 'rpActs');
    var bPlay = mk('button', 'rpAct play', '▶ Assistir'); bPlay.type = 'button';
    var bDl = mk('button', 'rpAct ico', '⬇'); bDl.type = 'button'; bDl.title = 'Baixar'; bDl.setAttribute('aria-label', 'Baixar replay');
    var bDel = mk('button', 'rpAct ico del', '🗑'); bDel.type = 'button'; bDel.title = 'Apagar'; bDel.setAttribute('aria-label', 'Apagar replay');
    bPlay.onclick = function () { loadFull(m).then(function (obj) { if (obj) FH_REPLAY.open(obj); }); };
    bDl.onclick = function () { loadFull(m).then(function (obj) { if (obj) downloadObj(obj, (m.map || 'partida') + '-' + (m.id || '')); }); };
    bDel.onclick = function () {
      fhConfirm('Apagar esta gravação?', { ok: 'Apagar', danger: true }).then(function (yes) {
        if (!yes) return;
        var p = m.source === 'online' ? api('/api/replays/' + m.id, 'DELETE').then(function () { return true; }) : FH_LIB.del(m.id);
        p.then(function () { toastX('Gravação apagada.'); FH_REPLAYS.refresh(); }).catch(function () { toastX('Falha ao apagar.'); });
      });
    };
    acts.appendChild(bPlay); acts.appendChild(bDl); acts.appendChild(bDel);
    c.appendChild(acts);
    return c;
  }
  function loadFull(m) {
    if (m.source === 'online') return api('/api/replays/' + m.id + '/file').catch(function () { toastX('Falha ao carregar replay.'); return null; });
    return FH_LIB.get(m.id).catch(function () { return null; });
  }
  window.FH_REPLAYS = FH_REPLAYS;

  function bindUI() {
    var h = document.getElementById('homeReplays'); if (h) h.onclick = function () { FH_REPLAYS.show(); };
    var b = document.getElementById('replaysBack'); if (b) b.onclick = function () { if (typeof show === 'function') show('homeScreen'); };
    var ta = $i('rpTabAcc'), td = $i('rpTabDev'); if (ta) ta.onclick = function () { setTab('acc'); }; if (td) td.onclick = function () { setTab('dev'); };
    ['rpQ', 'rpPlayer'].forEach(function (id) { var e = $i(id); if (e) e.addEventListener('input', renderList); });
    ['rpMode', 'rpDate', 'rpSort'].forEach(function (id) { var e = $i(id); if (e) e.addEventListener('change', renderList); });
    var imp = document.getElementById('replaysImport'), fi = document.getElementById('replaysFile');
    if (imp && fi) { imp.onclick = function () { fi.click(); }; fi.onchange = function () { if (fi.files && fi.files[0]) FH_REPLAYS.importFile(fi.files[0]); fi.value = ''; }; }
  }
  if (document.readyState !== 'loading') bindUI(); else document.addEventListener('DOMContentLoaded', bindUI);
})();
