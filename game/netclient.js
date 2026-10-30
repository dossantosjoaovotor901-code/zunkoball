/* netclient.js - NÚCLEO DE REDE DO CLIENTE (sem DOM; roda no navegador e nos testes em Node).
 *
 *  - Simulação em passo fixo (60 Hz) desacoplada do FPS de renderização (acumulador).
 *  - PREDIÇÃO: o jogador local executa a mesma física do servidor (game/sim.js) assim que aperta a tecla.
 *  - RECONCILIAÇÃO: a cada snapshot, restaura o estado autoritativo (tick S) e reexecuta as entradas que o
 *    servidor ainda não confirmou (rollback + replay). Jogadores remotos são extrapolados com a última
 *    entrada conhecida deles (vem no snapshot).
 *  - SUAVIZAÇÃO DE ERRO: a diferença visual entre "antes" e "depois" da reconciliação vira um offset que
 *    decai rápido (a simulação em si nunca é "escondida": só a apresentação é suavizada).
 *  - ESPECTADOR / sem vaga: interpolação de snapshots com atraso fixo (padrão 100 ms).
 *  - CONTROLE DE RITMO: o servidor informa quantas entradas suas estão na fila; o cliente acelera/desacelera
 *    levemente (±6%) para manter a fila em ~2 ticks, sem congelar nem estourar.
 *  - MÉTRICAS: rtt, jitter, fps, fila, erro de predição, bytes/s, lacunas de snapshot. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./sim.js'), require('./proto.js'));
  else root.FHNet = factory(root.FHSim, root.FHProto);
})(typeof self !== 'undefined' ? self : this, function (Sim, Proto) {
  'use strict';
  const DT = Sim.TICK_DT, TICK_MS = 1000 / Sim.TICK_RATE;
  const MAX_CATCHUP_TICKS = 10;
  const HIST = 180;
  const clamp127 = v => { v = Math.round(v) || 0; return v > 127 ? 127 : v < -127 ? -127 : v; };   // o campo é int8: nunca deixar estourar

  class Client {
    /* env: { send(data), now() -> ms, getMap(key) -> mapa, onEvent(ev), onMsg(json), input() -> {x,y} (-127..127) } */
    constructor(env, opts) {
      this.env = env; opts = opts || {};
      this.predict = opts.predict !== false;          // false = linha de base "sem predição" (só para medir)
      this.interpDelayTicks = opts.interpDelayTicks || 6;
      this.qTarget = opts.qTarget == null ? 2 : opts.qTarget;
      this.reset();
    }
    reset() {
      this.w = null; this.auth = null; this.slot = -1; this.me = 0; this.room = null; this.started = false;
      this.seq = 0; this.pending = []; this.acc = 0; this.rate = 1; this.hasBase = false;
      this.kickLatch = 0; this.passLatch = 0;
      this.prevPos = null; this.hist = new Map(); this.off = [];
      this.snapBuf = []; this.lastSnapAt = 0; this.lastSnapTick = 0;
      this.roster = []; this.localKickAt = -1e9; this.lastEvTick = -1;
      this.st = { rtt: 0, jitter: 0, fps: 60, qlen: 0, err: 0, errMax: 0, errAvg: 0, errN: 0, snaps: 0, gaps: 0, bytesIn: 0, bytesInWin: 0, winAt: 0,
        bps: 0, snapHz: 0, snapWin: 0, corr: 0, ticksRun: 0, replayTicks: 0, reconciles: 0, starved: 0 };
      this._rttAvg = null; this._pingAt = 0; this._statAt = 0;
    }

    /* ---------- recepção ---------- */
    onMessage(data, isBinary) {
      const now = this.env.now();
      if (isBinary) {
        const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
        this.st.bytesInWin += u8.length;
        if (u8[0] === Proto.T.SNAP) this._snap(u8, now);
        else if (u8[0] === Proto.T.PONG && u8.length === 13) this._pong(new DataView(u8.buffer, u8.byteOffset, 13).getFloat64(1), now);
        return;
      }
      this.st.bytesInWin += data.length;
      let m; try { m = JSON.parse(data); } catch (e) { return; }
      switch (m.t) {
        case 'welcome': this._welcome(m); break;
        case 'start': {
          // Cada partida nova deve começar com um estado de predição limpo. Reutilizar auth/w
          // da partida anterior pode deixar o cliente preso esperando uma base de snapshots antiga.
          this.room = m.room || this.room;
          this._resetMatchState(this.room);
          this.started = true;
          break;
        }
        case 'lobby':
          this.started = false; this.hasBase = false; this.pending.length = 0; this.acc = 0; this.rate = 1;
          this.w = null; this.auth = null; this.prevPos = null; this.hist.clear(); this.off = [];
          this.snapBuf.length = 0; this.lastSnapAt = 0; this.lastSnapTick = 0; this.lastEvTick = -1;
          this.kickLatch = 0; this.passLatch = 0; this.room = m.room || this.room;
          break;
        case 'roster': {
          this.roster = m.players; this.adminId = m.admin; this.mods = m.mods || []; if (m.snapEvery) this.snapEvery = m.snapEvery;
          const mine = m.players.find(p => p.id === this.me);
          if (mine && mine.slot !== this.slot) {            // mudou de time / virou espectador: recomeça do próximo snapshot completo
            this.slot = mine.slot; this.hasBase = false; this.pending.length = 0; this.hist.clear(); this.off = [];
            this.env.send(JSON.stringify({ t: 'resync' }));
          }
          break;
        }
        case 'ev': for (const e of m.e) this._serverEvent(e, now); break;
      }
      if (this.env.onMsg) this.env.onMsg(m);
    }
    _resetMatchState(room) {
      if (!room) return;
      this.map = this.env.getMap(room.map);
      this.w = Sim.create(this.map, { style: room.style, scoreLimit: room.scoreLimit, timeLimit: room.timeLimit * 60 });
      const cfg = this.w.cfg;
      this.makePlayer = () => ({ present: false, id: 0, team: 0, x: -100, y: -100, vx: 0, vy: 0, r: Sim.PLAYER_R, mass: cfg.pp.density,
        kickBuf: 0, passBuf: 0, lock: 0, lastAct: 0, ix: 0, iy: 0 });
      this.auth = Sim.cloneState(this.w.s);
      this.pending.length = 0; this.acc = 0; this.rate = 1; this.hasBase = false;
      this.prevPos = null; this.hist.clear(); this.off = []; this.snapBuf.length = 0;
      this.lastSnapAt = 0; this.lastSnapTick = 0; this.lastEvTick = -1;
      this.kickLatch = 0; this.passLatch = 0; this.localKickAt = -1e9;
    }
    _welcome(m) {
      this.me = m.you; this.slot = m.slot; this.room = m.room; this.started = m.started; this.snapEvery = m.snapEvery || 2;
      this.seq = 0;
      this._resetMatchState(m.room);
    }
    _pong(t, now) {
      const rtt = now - t, s = this.st;
      if (this._rttAvg == null) this._rttAvg = rtt;
      s.jitter += (Math.abs(rtt - this._rttAvg) - s.jitter) * 0.1;
      this._rttAvg += (rtt - this._rttAvg) * 0.2;
      s.rtt = this._rttAvg;
    }
    _serverEvent(e, now) {
      const [type, tick, a, b, c, d] = e;
      // o próprio chute já tocou localmente (predição): ignora o eco do servidor
      if (type === Sim.EV.KICK && this.slot >= 0 && a === this.slot && now - this.localKickAt < 500) return;
      if (this.env.onEvent) this.env.onEvent({ type, tick, a, b, c, d, predicted: false });
    }

    _snap(u8, now) {
      if (!this.auth) return;
      const s = this.st, prevTick = this.auth.tick;
      const meta = Proto.decodeSnapshot(u8, this.auth, this.makePlayer);
      if (!meta) return;
      if (!this.hasBase && !meta.full) { this.env.send(JSON.stringify({ t: 'resync' })); return; }
      this.hasBase = true;
      if (this.lastSnapTick && this.auth.tick - this.lastSnapTick > this.snapEvery * 1.5 && this.auth.tick > this.lastSnapTick) s.gaps++;
      this.lastSnapTick = this.auth.tick; this.lastSnapAt = now; s.snaps++; s.snapWin++;
      s.qlen = meta.qlen; this.lastAck = meta.ack;
      // controle de ritmo: mantém a fila do servidor perto de qTarget
      const q = meta.qlen, tgt = q >= 5 ? 0.94 : q >= 4 ? 0.98 : q <= 0 ? 1.04 : q <= 1 && this.qTarget >= 2 ? 1.015 : 1;
      this.rate += (tgt - this.rate) * 0.25;
      // buffer de interpolação (espectador / sem predição)
      const ents = [{ x: this.auth.ball.x, y: this.auth.ball.y }];
      for (const p of this.auth.players) ents.push({ x: p.x, y: p.y, present: p.present, team: p.team });
      this.snapBuf.push({ tick: this.auth.tick, at: now, ents, red: this.auth.red, blue: this.auth.blue, st: Sim.cloneState(this.auth) });
      if (this.snapBuf.length > 40) this.snapBuf.shift();
      if (this.predict && this.slot >= 0 && this.started) this._reconcile(meta, now);
    }

    /* ---------- reconciliação ---------- */
    _entPositions(st) {
      const out = [st.ball.x, st.ball.y];
      for (const p of st.players) out.push(p.x, p.y);
      return out;
    }
    _reconcile(meta) {
      const s = this.st, w = this.w, A = this.auth;
      // 1) erro de predição: o que eu previa para o tick S contra o que o servidor diz
      const h = this.hist.get(A.tick);
      if (h && A.players[this.slot]) {
        const p = A.players[this.slot];
        const e = Math.max(Math.sqrt((h[0] - p.x) ** 2 + (h[1] - p.y) ** 2), Math.sqrt((h[2] - A.ball.x) ** 2 + (h[3] - A.ball.y) ** 2) * 0);
        const eb = Math.sqrt((h[2] - A.ball.x) ** 2 + (h[3] - A.ball.y) ** 2);
        s.err = Math.max(e, eb); s.errMax = Math.max(s.errMax, s.err); s.errAvg += (s.err - s.errAvg) * 0.05; s.errN++;
      }
      // 2) posição visual antes (para o offset de suavização)
      const before = this.getRender();
      // 3) restaura estado autoritativo e reexecuta entradas não confirmadas
      if (meta.ack >= 0) while (this.pending.length && this.pending[0].seq <= meta.ack) this.pending.shift();
      w.s = Sim.cloneState(A); w.events.length = 0;
      this.prevPos = this._entPositions(w.s);
      for (const it of this.pending) this._advance(it, true);
      s.reconciles++; s.replayTicks += this.pending.length;
      // 4) offset visual = antes - depois (decai em frame())
      const after = this.getRender(true);
      if (before && after) {
        const n = Math.min(before.pos.length, after.pos.length);
        let jump = false;
        const dx = [];
        for (let i = 0; i < n; i++) { dx[i] = before.pos[i] - after.pos[i]; if (Math.abs(dx[i]) > 3) jump = true; }
        this.off = jump ? [] : dx.map((v, i) => (this.off[i] || 0) * 0 + v);
        let m = 0; for (let i = 0; i < n; i += 2) m = Math.max(m, Math.abs(dx[i]) + Math.abs(dx[i + 1]));
        s.corr = jump ? 0 : m;
      }
    }

    /* ---------- simulação local ---------- */
    _inputs(localIt) {
      const st = this.w.s, arr = [];
      for (let i = 0; i < st.players.length; i++) {
        const p = st.players[i];
        arr[i] = i === this.slot ? localIt : { x: p.ix | 0, y: p.iy | 0, kick: 0, pass: 0 };    // remotos: última entrada conhecida
      }
      return arr;
    }
    _advance(it, replay) {
      const w = this.w;
      this.prevPos = this._entPositions(w.s);
      Sim.step(w, this._inputs(it));
      this.hist.set(w.s.tick, [w.s.players[this.slot] ? w.s.players[this.slot].x : 0, w.s.players[this.slot] ? w.s.players[this.slot].y : 0, w.s.ball.x, w.s.ball.y]);
      if (this.hist.size > HIST) this.hist.delete(w.s.tick - HIST);
      if (w.events.length) {
        if (!replay) for (const e of w.events) {
          // só o chute local toca de imediato (resto vem do servidor para não duplicar)
          if (e.type === Sim.EV.KICK && e.a === this.slot && this.env.onEvent) {
            this.localKickAt = this.env.now(); this.env.onEvent({ type: e.type, tick: e.tick, a: e.a, b: e.b, predicted: true });
          }
        }
        w.events.length = 0;
      }
    }
    pressKick() { this.kickLatch = 1; }
    pressPass() { this.passLatch = 1; }

    /* Chamar a cada quadro renderizado com o dt real (ms). Roda N ticks fixos e envia as entradas. */
    frame(dtMs) {
      const now = this.env.now(), s = this.st;
      s.fps += ((1000 / Math.max(1, dtMs)) - s.fps) * 0.05;
      if (now - s.winAt >= 1000) { s.bps = s.bytesInWin * 1000 / (now - s.winAt || 1); s.snapHz = s.snapWin * 1000 / (now - s.winAt || 1); s.bytesInWin = 0; s.snapWin = 0; s.winAt = now; }
      if (now - this._pingAt >= 1000) { this._pingAt = now; this.env.send(Proto.encodePing(now)); }
      if (now - this._statAt >= 2000) { this._statAt = now; this.env.send(JSON.stringify({ t: 'stat', rtt: s.rtt, jit: s.jitter, fps: s.fps })); }
      if (this.paused) { this.acc = 0; return; }        // partida pausada pelo dono: não simula nem envia entradas
      if (!this.w || !this.started || !this.hasBase) return;
      if (this.slot >= 0) {      // com predição: simula localmente; sem predição (linha de base): só amostra e envia as entradas
        this.acc += Math.min(dtMs, MAX_CATCHUP_TICKS * TICK_MS) * this.rate / 1000;
        let ticks = 0;
        while (this.acc >= DT) {
          const inp = this.env.input ? this.env.input() : { x: 0, y: 0 };
          const it = { seq: this.seq++, x: clamp127(inp.x), y: clamp127(inp.y), kick: this.kickLatch, pass: this.passLatch };
          this.kickLatch = 0; this.passLatch = 0;
          this.pending.push(it);
          if (this.predict) this._advance(it, false);
          this.acc -= DT; ticks++; s.ticksRun++;
          if (this.pending.length > 60) this.pending.shift();    // proteção: servidor mudo por > 1 s
        }
        if (ticks) {
          const n = Math.min(Proto.MAX_INPUTS_PER_PACKET, ticks + 3);
          this.env.send(Proto.encodeInputs(this.pending.slice(-n)));    // novas + últimas redundantes
        }
        const k = Math.exp(-dtMs / 1000 * 16);                           // suavização visual (não afeta a física)
        for (let i = 0; i < this.off.length; i++) this.off[i] *= k;
        if (!this.predict) { while (this.pending.length && this.pending[0].seq <= this.lastAck) this.pending.shift(); }
      }
    }

    /* ---------- estado para desenhar ---------- */
    // devolve { pos:[bx,by,p0x,p0y,...], s: estado base, phase, red, blue, time }
    getRender(noOffset) {
      if (this.predict && this.slot >= 0 && this.w && this.started && this.hasBase) {
        const cur = this._entPositions(this.w.s), prev = this.prevPos || cur, a = Math.max(0, Math.min(1, this.acc / DT));
        const pos = cur.map((v, i) => prev[i] + (v - prev[i]) * a + (noOffset ? 0 : (this.off[i] || 0)));
        return { pos, s: this.w.s };
      }
      return this._interp();
    }
    _interp() {
      const b = this.snapBuf; if (!b.length || !this.started) return null;
      const now = this.env.now(), last = b[b.length - 1];
      const estTick = last.tick + (now - last.at) / TICK_MS, target = estTick - this.interpDelayTicks;
      let i = b.length - 1; while (i > 0 && b[i].tick > target) i--;
      const A = b[i], B = b[Math.min(i + 1, b.length - 1)];
      const f = B.tick === A.tick ? 0 : Math.max(0, Math.min(1, (target - A.tick) / (B.tick - A.tick)));
      const pos = [];
      const ne = Math.min(A.ents.length, B.ents.length);
      for (let k = 0; k < ne; k++) {
        const ea = A.ents[k], eb = B.ents[k];
        const x = ea.x + (eb.x - ea.x) * f, y = ea.y + (eb.y - ea.y) * f;
        pos.push(x, y);
      }
      return { pos, s: B.st };
    }
  }
  return { Client };
});
