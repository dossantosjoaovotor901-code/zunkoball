'use strict';
/* Sala autoritativa do FutHub: roda a simulação (game/sim.js), recebe entradas dos jogadores,
 * valida tudo e envia snapshots. É independente do transporte: o "conn" só precisa de
 *   conn.send(data), conn.buffered (bytes pendentes), conn.close(code)
 * e a sala é chamada com room.onMessage(client, data, isBinary) / room.tick().
 * O agendador (gameserver.js) chama tick() a 60 Hz; os testes chamam tick() com relógio virtual. */
const Sim = require('../game/sim.js');
const Proto = require('../game/proto.js');
const { loadMaps } = require('./maps');
const { Recorder } = require('./replay');

const MAPS = loadMaps();
const SNAP_EVERY = 2;                  // snapshot a cada 2 ticks = 30 Hz
const MAX_QUEUE = 8, TRIM_TO = 3;      // fila de entradas por jogador (anti speed-hack e recuperação de rajadas)
const BACKPRESSURE_BYTES = 64 * 1024;  // cliente lento: não empilha snapshots
const END_SCREEN_TICKS = 2 * 60;
const PAUSE_MAX_TICKS = 60 * 60;       // pausa do dono volta sozinha em 60 s (evita sala travada)
const IDLE_MS = 10000;                 // sem nenhuma mensagem (nem ping) = desconecta
const RANKED_JOIN_MS = +process.env.FUTHUB_RANKED_JOIN_MS || 25000, RANKED_GRACE_MS = +process.env.FUTHUB_RANKED_GRACE_MS || 20000;

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const isFin = v => typeof v === 'number' && isFinite(v);

class Room {
  constructor(o, env) {
    this.env = env || {};
    this.id = o.id; this.name = clean(o.name, 30) || 'Sala';
    this.password = o.password ? String(o.password).slice(0, 30) : '';
    this.max = Math.max(2, Math.min(30, o.max | 0 || 8));
    this.mapKey = MAPS.MAPS[o.mapKey] ? o.mapKey : 'v3';
    const map = MAPS.MAPS[this.mapKey];
    this.style = o.style === 'real' || map.style === 'real' ? 'real' : 'futsal';
    this.scoreLimit = Math.max(1, Math.min(20, o.scoreLimit | 0 || 5));
    this.timeLimit = Math.max(1, Math.min(30, o.timeLimit | 0 || 5));
    this.arbitration = !!o.arbitration;
    this.overtime = this.arbitration ? Math.max(0, Math.min(10, o.overtime | 0 || 2)) : 0;
    this.goldenGoal = o.goldenGoal !== false;
    this.ranked = o.ranked || null;     // { matchId, mode, users:{userId:team}, rules }
    this.country = o.country || 'BR';
    this.clients = new Map();           // clientId -> client
    this.nextId = 1; this.joinSeq = 0;
    this.started = false; this.endTick = -1; this.createdAt = Date.now();
    this.banned = new Set();            // banidos desta sala (uid ou nick)
    this.lastTeam = new Map();          // memória de time para quem cai e volta
    this.lastBench = new Map();         // memória de banco (1/2) para quem cai e volta
    this.snapEvery = SNAP_EVERY;
    this.evBuf = [];
    this.m = { ticks: 0, tickNs: 0, tickNsMax: 0, snapSent: 0, snapSkipped: 0, bytesSnap: 0, invalid: 0, starved: 0, trimmed: 0 };
    this.world = null; this.result = null; this._endHold = 0; this.paused = false; this._pauseT = 0; this.emptySince = 0;
    this.rec = null;                    // gravacao de replay da partida em andamento (null = desligada)
    this.rankedDeadline = this.ranked ? Date.now() + RANKED_JOIN_MS : 0;
    this._newWorld();
  }
  _newWorld() {
    this.world = Sim.create(MAPS.MAPS[this.mapKey], { style: this.style, scoreLimit: this.scoreLimit, timeLimit: this.timeLimit * 60,
      arbitration: this.arbitration, overtime: this.overtime * 60, goldenGoal: this.goldenGoal });
    for (const c of this.clients.values()) { c.slot = -1; if (c.team) this._seat(c, c.team); }
  }
  get size() { return this.clients.size; }
  get players() { let n = 0; for (const c of this.clients.values()) if (c.team) n++; return n; }

  /* ---------- entrada/saída ---------- */
  join(conn, info) {
    if (this.clients.size >= this.max) return { error: 'Sala cheia.' };
    if (this.password && info.password !== this.password) return { error: 'Senha incorreta.' };
    { const bk = info.user ? info.user.id : 'n:' + clean(info.nick, 16).toLowerCase(); if (this.banned.has(bk)) return { error: 'Você foi banido desta sala.' }; }
    if (this.ranked) { if (!info.user || !(info.user.id in this.ranked.users)) return { error: 'Esta é uma partida ranqueada de outros jogadores.' }; }
    const uid = info.user ? info.user.id : null;
    if (uid) for (const c of this.clients.values()) if (c.uid === uid) { this._drop(c, 'Conectado em outro lugar.'); break; }
    const c = { id: this.nextId++, conn, uid, nick: clean(info.nick, 16) || 'Jogador', avatar: clean(info.avatar, 3) || 'P1', kit: (info.user && info.user.kit) || null, fx: (info.user && info.user.fx) || null, team: 0, slot: -1,
      order: this.joinSeq++, queue: [], lastSeq: -1, lastIn: { x: 0, y: 0 }, ack: -1, basis: {}, needFull: true, rtt: 0, jitter: 0, fps: 0,
      tokens: 300, tokAt: Date.now(), bad: 0, badAt: Date.now(), lastMsg: Date.now(), chatAt: 0, stats: { in: 0, starved: 0, trimmed: 0, dup: 0 },
      held: null, joinedAt: Date.now() };
    this.clients.set(c.id, c);
    let team = 0;
    if (this.ranked) team = this.ranked.users[uid];
    else {
      const mem = this.lastTeam.get(uid || ('n:' + c.nick));
      const cnt = t => [...this.clients.values()].filter(x => x.team === t).length;
      team = mem != null ? mem : (cnt(1) <= cnt(2) ? 1 : 2);
    }
    const bkey = uid || ('n:' + c.nick), bn = this.ranked ? 0 : this.lastBench.get(bkey);
    if (bn) { this._seat(c, 0); c.bench = bn; this.lastBench.set(bkey, bn); } else this._seat(c, team);
    this._send(c, JSON.stringify({ t: 'welcome', you: c.id, slot: c.slot, tickRate: Sim.TICK_RATE, tick: this.world.s.tick, room: this.info(),
      started: this.started, paused: this.paused, snapEvery: this.snapEvery }));
    this._roster();
    this._chatSys(c.nick + ' entrou.');
    return { client: c };
  }
  _seat(c, team) {                       // coloca no time (1/2) ou espectador (0)
    if (c.slot >= 0) { Sim.removePlayer(this.world, c.slot); c.slot = -1; }
    c.bench = 0; this.lastBench.delete(c.uid || ('n:' + c.nick));
    c.team = team;
    c.needFull = true; c.basis = {};
    if (team) { c.slot = Sim.addPlayer(this.world, team, c.id); c.queue.length = 0; this.lastTeam.set(c.uid || ('n:' + c.nick), team); }
  }
  leave(c, why) {
    if (!this.clients.has(c.id)) return;
    const wasAdmin = this.admin() === c;
    this.clients.delete(c.id);
    if (!this.clients.size) this.emptySince = Date.now();
    if (c.slot >= 0) Sim.removePlayer(this.world, c.slot);
    c.disconnectedAt = Date.now();
    if (this.ranked && this.started && !this.result) this.ranked.absent = Object.assign(this.ranked.absent || {}, { [c.uid]: Date.now() });
    this._roster();
    if (!this.ranked) this._chatSys(c.nick + ' saiu.');
    // o dono saiu de propósito (botão sair/fechar aba): a sala fecha e some da lista. Queda de rede NÃO fecha (o cliente reconecta; o dono migra se não voltar).
    if (!this.ranked && wasAdmin && why === 'leave') this._closeRoom('O dono fechou a sala.');
  }
  _closeRoom(msg) {
    this.closing = true;
    for (const o of [...this.clients.values()]) this._drop(o, msg);
  }
  _drop(c, msg) { try { this._send(c, JSON.stringify({ t: 'bye', msg })); c.conn.close(1000); } catch (e) {} this.leave(c); }
  isAdm(c) { return this.admin() === c || c.mod === true; }          // dono ou admin promovido
  _canHit(c, v) { return v !== this.admin() && (this.admin() === c || !v.mod); }   // ninguém expulsa o dono; só o dono expulsa outros admins
  admin() { let a = null; for (const c of this.clients.values()) if (!a || c.order < a.order) a = c; return a; }   // migração = o mais antigo

  info() {
    return { id: this.id, name: this.name, map: this.mapKey, style: this.style, max: this.max, scoreLimit: this.scoreLimit,
      timeLimit: this.timeLimit, arbitration: this.arbitration, overtime: this.overtime, goldenGoal: this.goldenGoal,
      ranked: !!this.ranked, pass: !!this.password };
  }
  listing() { return Object.assign(this.info(), { players: this.clients.size, started: this.started, country: this.country }); }

  /* ---------- mensagens do cliente ---------- */
  onMessage(c, data, isBinary) {
    const now = Date.now();
    c.tokens = Math.min(300, c.tokens + (now - c.tokAt) * 0.15); c.tokAt = now;       // 150 msg/s sustentado, rajada 300
    if (--c.tokens < 0) { this._bad(c, 'flood'); return; }
    c.lastMsg = now;
    if (isBinary) {
      const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
      const t = u8[0];
      if (t === Proto.T.INPUT) return this._inputs(c, u8);
      if (t === Proto.T.PING && u8.length === 9) {
        const v = new DataView(u8.buffer, u8.byteOffset, 9).getFloat64(1);
        if (isFin(v)) this._send(c, Proto.encodePong(v, this.world.s.tick));
        return;
      }
      return this._bad(c, 'bin');
    }
    let m; try { m = JSON.parse(data); } catch (e) { return this._bad(c, 'json'); }
    if (!m || typeof m !== 'object') return this._bad(c, 'json');
    switch (m.t) {
      case 'team': {
        const t = m.team === 1 || m.team === 2 ? m.team : 0;
        if (this.ranked || (t && c.team === t)) return;
        if (c.bench && !this.isAdm(c)) return;          // reserva só volta a jogar quando o admin chamar
        this._seat(c, t); this._roster(); break;
      }
      case 'chat': {
        if (now - c.chatAt < 700) return; c.chatAt = now;
        const txt = clean(m.m, 140); if (txt) this._bcast(JSON.stringify({ t: 'chat', from: c.nick, m: txt }));
        break;
      }
      case 'move': {            // admin move qualquer jogador de time / banco
        if (this.ranked || !this.isAdm(c)) return;
        const v = this.clients.get(m.id | 0);
        if (!v) break;
        if (m.bench === 1 || m.bench === 2) { this._seat(v, 0); v.bench = m.bench; this.lastBench.set(v.uid || ('n:' + v.nick), m.bench); this._roster(); break; }   // reserva do time 1 (vermelho) ou 2 (azul)
        const t = m.team === 1 || m.team === 2 ? m.team : 0;
        if (v.team !== t || v.bench) { this._seat(v, t); this._roster(); }
        break;
      }
      case 'start': if (!this.ranked && this.isAdm(c)) this.start(); break;
      case 'config': {
        if (this.ranked || !this.isAdm(c) || this.started) return;
        const r = this.configure(m);
        if (r.error) return this._send(c, JSON.stringify({ t: 'error', msg: r.error }));
        this._bcast(JSON.stringify({ t: 'config', room: this.info() }));
        this._roster();
        break;
      }
      case 'restart': if (!this.ranked && this.isAdm(c) && this.started) this.start(true); break;       // reinicia a partida em andamento
      case 'pause': {            // só o dono, só sala casual, só com partida rolando
        if (this.ranked || !this.isAdm(c) || !this.started || this.world.s.phase === Sim.PH.ENDED) return;
        this.paused = !this.paused; this._pauseT = 0;
        this._bcast(JSON.stringify({ t: 'pause', on: this.paused }));
        break;
      }
      case 'stop': if (!this.ranked && this.isAdm(c)) this.stop(); break;
      case 'kick': {
        if (!this.isAdm(c) || this.ranked) return;
        const v = this.clients.get(m.id | 0); if (!v || v === c || !this._canHit(c, v)) return;
        this._drop(v, 'Você foi removido da sala.');
        break;
      }
      case 'admin': {           // só o dono da sala promove / remove admins (pode haver vários)
        if (this.admin() !== c || this.ranked) return;
        const v = this.clients.get(m.id | 0); if (!v || v === c) return;
        v.mod = !v.mod; this._roster();
        this._chatSys(v.nick + (v.mod ? ' agora é admin.' : ' não é mais admin.'));
        break;
      }
      case 'ban': {             // expulsa e impede de voltar a esta sala
        if (!this.isAdm(c) || this.ranked) return;
        const v = this.clients.get(m.id | 0); if (!v || v === c || !this._canHit(c, v)) return;
        this.banned.add(v.uid ? v.uid : 'n:' + v.nick.toLowerCase());
        this._drop(v, 'Você foi banido desta sala.');
        break;
      }
      case 'resync': c.needFull = true; break;
      case 'stat':   // métricas que o cliente mede (ping/jitter/fps) – só informativo, nunca afeta a física
        if (isFin(m.rtt) && isFin(m.jit) && isFin(m.fps)) { c.rtt = Math.max(0, Math.min(5000, m.rtt)); c.jitter = Math.max(0, Math.min(5000, m.jit)); c.fps = Math.max(0, Math.min(1000, m.fps)); }
        break;
      default: this._bad(c, 'type');
    }
  }
  _bad(c, why) {
    this.m.invalid++;
    const now = Date.now();
    if (now - c.badAt > 10000) { c.bad = 0; c.badAt = now; }
    if (++c.bad > 40) this._drop(c, 'Mensagens inválidas demais.');
  }
  _inputs(c, u8) {
    const list = Proto.decodeInputs(u8);
    if (!list) return this._bad(c, 'input');
    if (c.slot < 0) return;
    for (const it of list) {
      if (it.seq <= c.lastSeq) { c.stats.dup++; continue; }                 // reenvio redundante / fora de ordem
      if (it.seq > c.lastSeq + 1000 && c.lastSeq >= 0) return this._bad(c, 'seq');
      c.lastSeq = it.seq; c.stats.in++;
      c.queue.push(it);
    }
    if (c.queue.length > MAX_QUEUE) {          // rajada (lag spike) ou cliente acelerado: descarta o mais velho mas preserva chutes
      const cut = c.queue.length - TRIM_TO, dropped = c.queue.splice(0, cut);
      const kick = dropped.some(d => d.kick), pass = dropped.some(d => d.pass);
      if (kick) c.queue[0].kick = 1; if (pass) c.queue[0].pass = 1;
      c.stats.trimmed += cut; this.m.trimmed += cut;
    }
  }

  /* ---------- ciclo da partida ---------- */
  start(force) {
    if (this.started && !force && this.world.s.phase !== Sim.PH.ENDED) return;
    this._recSave('restart');            // se havia gravacao em andamento, salva como reinicio antes de recomecar
    this.paused = false; this._pauseT = 0;
    this._newWorld(); this.started = true; this.result = null; this.endTick = -1;
    for (const c of this.clients.values()) { c.queue.length = 0; c.needFull = true; c.basis = {}; }
    this._bcast(JSON.stringify({ t: 'start', tick: this.world.s.tick, room: this.info() }));
    this._recStart();
    this._roster();
  }
  stop() {
    this._recSave('stopped');
    // Limpa completamente o ciclo anterior. O próximo start deve ser uma partida nova,
    // sem resultado/end-hold/estado de pausa herdado da partida interrompida.
    this.started = false; this.paused = false; this.result = null; this._endHold = 0; this.endTick = -1; this.evBuf.length = 0;
    this._newWorld();
    for (const c of this.clients.values()) {
      c.queue.length = 0; c.lastSeq = -1; c.ack = -1; c.lastIn = { x: 0, y: 0 };
      c.needFull = true; c.basis = {}; c.held = null;
    }
    this._bcast(JSON.stringify({ t: 'lobby', room: this.info() }));
  }
  configure(m) {
    const mapKey = String(m.map || this.mapKey);
    if (!MAPS.MAPS[mapKey]) return { error: 'Modalidade/campo inválido.' };
    const score = Number.isFinite(+m.score) ? Math.max(1, Math.min(20, +m.score | 0)) : this.scoreLimit;
    const time = Number.isFinite(+m.time) ? Math.max(1, Math.min(30, +m.time | 0)) : this.timeLimit;
    this.mapKey = mapKey;
    this.style = MAPS.MAPS[mapKey].style === 'real' || m.style === 'real' ? 'real' : 'futsal';
    this.scoreLimit = score; this.timeLimit = time;
    if (!this.ranked) {
      this.arbitration = m.arbitration === true;
      this.overtime = this.arbitration ? Math.max(0, Math.min(10, (+m.overtime || 0) | 0)) : 0;
      this.goldenGoal = m.goldenGoal !== false;
    }
    this._newWorld();
    return { ok: true };
  }
  _forfeit(uid) {                // ranqueada: quem não aparece/abandona perde 0x3 (igual ao fluxo existente de abandono)
    if (this.result) return;
    const team = this.ranked.users[uid], s = this.world.s;
    this.result = { red: team === 1 ? 0 : 3, blue: team === 1 ? 3 : 0, forfeitBy: uid, ended: 'forfeit' };
    s.phase = Sim.PH.ENDED; this._finish();
  }
  _void() {                      // ranqueada anulada (nenhum jogador conectou a tempo)
    if (this.result) return;
    this.result = { red: 0, blue: 0, ended: 'void', void: true };
    this.world.s.phase = Sim.PH.ENDED; this._finish();
  }
  _finish() {
    const s = this.world.s;
    if (!this.result) this.result = { red: s.red, blue: s.blue, ended: 'normal' };
    this.endTick = s.tick;
    this._bcast(JSON.stringify({ t: 'end', red: this.result.red, blue: this.result.blue, ended: this.result.ended }));
    if (this.ranked && this.env.onRankedEnd) { try { this.env.onRankedEnd(this, this.result); } catch (e) { console.error(e); } }
    this._recSave(this.result.ended || 'normal', { red: this.result.red, blue: this.result.blue });
  }

  /* ---------- gravacao de replay (estado autoritativo) ---------- */
  _recStart() {
    if (typeof this.env.saveReplay !== 'function') return;     // gravacao desligada neste servidor
    try {
      this.rec = new Recorder({
        id: this.id + '-' + Date.now().toString(36), map: this.mapKey, style: this.style,
        scoreLimit: this.scoreLimit, timeLimit: this.timeLimit, ranked: !!this.ranked,
        mode: 'online', appVersion: this.env.appVersion || ''
      });
      for (const c of this.clients.values()) if (c.uid) this.rec.addUser(c.uid);
      this._recRoster();
      this.rec.sample(this.world.s, true);
    } catch (e) { this.rec = null; console.error('replay start', e); }
  }
  _recRoster() {
    if (!this.rec) return;
    const players = [...this.clients.values()].filter(c => c.slot >= 0)
      .map(c => ({ slot: c.slot, nick: c.nick, av: c.avatar, team: c.team, uid: c.uid }));
    try { this.rec.roster(players, this.world.s.tick); } catch (e) {}
  }
  _recSave(reason, score) {
    if (!this.rec) return;
    const rec = this.rec; this.rec = null;
    try {
      rec.sample(this.world.s, true);
      rec.finalize(reason, score);
      if (this.env.saveReplay) this.env.saveReplay(rec);
    } catch (e) { console.error('replay save', e); }
  }

  tick() {
    const t0 = process.hrtime.bigint(), now = Date.now(), w = this.world, s = w.s;
    // vigia de inatividade e de ranqueada
    for (const c of [...this.clients.values()]) if (now - c.lastMsg > IDLE_MS) this._drop(c, 'Sem resposta.');
    if (this.ranked && !this.result) {
      if (!this.started) {
        const present = new Set([...this.clients.values()].map(c => c.uid));
        if (Object.keys(this.ranked.users).every(u => present.has(u))) this.start();
        else if (now > this.rankedDeadline) {
          const missing = Object.keys(this.ranked.users).filter(u => !present.has(u));
          if (missing.length === Object.keys(this.ranked.users).length) this._void();   // ninguém apareceu: anula, sem pontos para ninguém
          else this._forfeit(missing[0]);
        }
      } else if (this.ranked.absent) {
        for (const u of Object.keys(this.ranked.absent)) {
          if ([...this.clients.values()].some(c => c.uid === u)) delete this.ranked.absent[u];
          else if (now - this.ranked.absent[u] > RANKED_GRACE_MS) { this._forfeit(u); break; }
        }
      }
    }
    if (!this.ranked && this.m.ticks % 180 === 0 && this.clients.size) {      // ping de todos para a tela da sala (a cada 3 s)
      const p = {}; for (const c of this.clients.values()) p[c.id] = Math.round(c.rtt);
      this._bcast(JSON.stringify({ t: 'pings', p }));
    }
    if (this.started && this.paused) {
      if (++this._pauseT > PAUSE_MAX_TICKS) { this.paused = false; this._bcast(JSON.stringify({ t: 'pause', on: false })); }
      if (this.m.ticks % this.snapEvery === 0) this._snapshots();
    } else if (this.started) {
      const inputs = [];
      for (const c of this.clients.values()) {
        if (c.slot < 0) continue;
        let it = c.queue.shift();
        if (it) { c.ack = it.seq; c.lastIn = { x: it.x, y: it.y }; }
        else { it = { x: c.lastIn.x, y: c.lastIn.y, kick: 0, pass: 0 }; if (c.lastSeq >= 0) { c.stats.starved++; this.m.starved++; } }  // repete direção, nunca chute
        inputs[c.slot] = it;
      }
      if (s.phase !== Sim.PH.ENDED) {
        Sim.step(w, inputs);
        if (w.events.length) {
          for (const e of w.events) { this.evBuf.push([e.type, e.tick, e.a, e.b, e.c, e.d]); if (this.rec) this.rec.event([e.type, e.tick, e.a, e.b, e.c, e.d]); }
          w.events.length = 0;
        }
        if (this.rec) this.rec.sample(s);
        if (s.phase === Sim.PH.ENDED && !this.result) this._finish();
        this._endHold = 0;
      } else {                                  // tela de fim: depois de 5 s volta ao lobby (casual) ou fecha (ranqueada)
        this._endHold = (this._endHold || 0) + 1;
        if (this.ranked) { if (this._endHold > 120) this.closing = true; }
        else if (this._endHold >= END_SCREEN_TICKS) { this._endHold = 0; this.stop(); }
      }
      if (this.m.ticks % this.snapEvery === 0) this._snapshots();
    } else if (this.ranked && this.result) {      // ranqueada encerrada antes de começar (W.O./anulada): fecha a sala em 2 s
      if (++this._endHold > 120) this.closing = true;
    }
    const dt = Number(process.hrtime.bigint() - t0);
    this.m.ticks++; this.m.tickNs += dt; if (dt > this.m.tickNsMax) this.m.tickNsMax = dt;
  }
  _snapshots() {
    const s = this.world.s;
    const ev = this.evBuf.length ? JSON.stringify({ t: 'ev', e: this.evBuf }) : null;
    this.evBuf = [];
    for (const c of this.clients.values()) {
      if (c.conn.buffered > BACKPRESSURE_BYTES) { this.m.snapSkipped++; continue; }    // cliente/rota lenta: pula, não acumula
      if (ev) this._send(c, ev);
      const b = Proto.encodeSnapshot(s, c.ack, c.queue.length, c.basis, c.needFull); c.needFull = false;
      this.m.snapSent++; this.m.bytesSnap += b.length;
      this._send(c, b);
    }
  }
  /* ---------- envio ---------- */
  _send(c, d) { try { c.conn.send(d); } catch (e) {} }
  _bcast(d) { for (const c of this.clients.values()) this._send(c, d); }
  _chatSys(m) { this._bcast(JSON.stringify({ t: 'chat', from: '', m })); }
  _roster() {
    const adm = this.admin();
    this.snapEvery = this.clients.size > 12 ? 3 : SNAP_EVERY;       // salas grandes: 20 Hz em vez de 30 Hz (menos banda; clientes predizem de qualquer forma)
    this._bcast(JSON.stringify({ t: 'roster', snapEvery: this.snapEvery, admin: adm ? adm.id : 0, mods: [...this.clients.values()].filter(c => c.mod).map(c => c.id), players: [...this.clients.values()].map(c => ({
      id: c.id, slot: c.slot, nick: c.nick, av: c.avatar, kit: c.kit || undefined, fx: c.fx || undefined, team: c.team, bench: c.bench || 0, rtt: Math.round(c.rtt) })) }));
    this._recRoster();
  }
  destroy() { this._recSave('abandon'); for (const c of [...this.clients.values()]) { try { c.conn.close(1001); } catch (e) {} } this.clients.clear(); }
}
module.exports = { Room, MAPS };
