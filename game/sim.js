/* sim.js - FÍSICA COMPARTILHADA DO FUTHUB (servidor e cliente rodam exatamente este arquivo).
 *
 * Regras de projeto (necessárias para predição + reconciliação funcionarem):
 *  1. PASSO FIXO: toda a simulação avança em ticks de 1/60 s (TICK_DT). Nunca usa o tempo do relógio
 *     nem o FPS; quem renderiza mais rápido ou mais devagar só executa mais ou menos ticks por quadro.
 *  2. DETERMINISTA: sem Math.random, sem Date, sem DOM/áudio. Só + - * / e sqrt (exatos em IEEE-754);
 *     nada de exp/pow/hypot (podem variar por motor JS). Posições/velocidades são arredondadas para
 *     float32 a cada tick, então o snapshot em Float32 do servidor é idêntico ao estado interno.
 *  3. SEM EFEITOS COLATERAIS: sons, partículas e rede de gol são "eventos" em w.events; quem usa decide.
 *  4. ESTADO SEPARADO DA CONFIGURAÇÃO: w.cfg (estático, vem do mapa) e w.s (dinâmico, clonável).
 *     Cliente clona/restaura w.s para reconciliar (rollback + replay).
 *
 * As constantes e fórmulas vêm de game.js (modo offline) para a sensação de jogo ser a mesma:
 *   velocidade do jogador 4.9, máx 6.35, chute = impulseWithKick*2.62*dt*60 + ballPower*40, etc.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FHSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TICK_RATE = 60;
  const TICK_DT = 1 / TICK_RATE;
  const MOVE_SPEED = 4.9, MAX_SPEED = 6.35, PLAYER_R = 0.68;
  const KICK_BUFFER = 12, KICK_REACH = 0.18, ACTION_LOCK = 9;      // buffers em TICKS (0,2 s e 0,15 s a 60 Hz)
  const GOAL_PAUSE_TICKS = 141, COUNTDOWN_TICKS = 3 * TICK_RATE, AUTO_RESTART_TICKS = 90;
  const PH = { COUNTDOWN: 0, PLAY: 1, GOAL: 2, ENDED: 3 };
  const EV = { KICK: 1, POST: 2, NET: 3, GOAL: 4, WHISTLE: 5, RESTART: 6, END: 7 };
  const fr = Math.fround;
  const len = (x, y) => Math.sqrt(x * x + y * y);

  /* ---------- criação ---------- */
  // opts: { style, scoreLimit, timeLimit, arbitration, overtime, goldenGoal }
  function create(map, opts) {
    opts = opts || {};
    const ba = map.BallAreaSettings, L = ba.Line;
    const gp = map.GoalProperty, gs = gp.GoalSettings;
    const cfg = {
      map,
      real: (opts.style || map.style) === 'real',
      scoreLimit: opts.scoreLimit || 5,
      timeTicks: Math.round((opts.timeLimit || 300) * TICK_RATE),
      arbitration: !!opts.arbitration,
      overtimeTicks: Math.max(0, Math.round((opts.overtime || 0) * TICK_RATE)),
      goldenGoal: opts.goldenGoal !== false,
      pw: map.PlayerAreaSettings.width, ph: map.PlayerAreaSettings.height,
      bx0: L[0].x1, bx1: L[0].x2, by0: L[0].y1, by1: L[1].y1,
      pp: map.PlayerProperty, bp: map.BallProperty,
      postR: gs.PostRadius, goalDepth: gs.GoalDept,
      ballR: fr(map.BallProperty.radius * 1.28),
      left: gp.GoalLine.filter(g => g.team === 1),
      right: gp.GoalLine.filter(g => g.team === 2)
    };
    cfg.cx = (cfg.bx0 + cfg.bx1) / 2; cfg.cy = (cfg.by0 + cfg.by1) / 2;
    cfg.nets = gp.GoalLine.map(g => {
      const dir = g.team === 1 ? -1 : 1;
      return { dir, x0: g.x1, depth: gs.GoalDept, y1: g.y1, y2: g.y2, pr: gs.PostRadius,
        post: [{ x: g.x1, y: g.y1 }, { x: g.x1, y: g.y2 }] };
    });
    const s = {
      tick: 0, phase: PH.COUNTDOWN, cd: COUNTDOWN_TICKS, timeTicks: cfg.timeTicks,
      red: 0, blue: 0, goalT: 0 /*ticks*/, goalTeam: 0, lastScorer: -1,
      lastTouchTeam: 0, lastTouchSlot: -1,            // 0 nenhum, 1 vermelho, 2 azul
      restartTeam: 0, barrierTeam: 0, overtime: false,
      restart: null,                                   // {type,team,x,y,t} (Real Soccer)
      players: [],
      ball: { x: fr(cfg.cx), y: fr(cfg.cy), vx: 0, vy: 0, r: cfg.ballR, mass: cfg.bp.density }
    };
    return { cfg, s, events: [], hooks: null };
  }

  const teamName = t => (t === 1 ? 'red' : 'blue');

  function addPlayer(w, team, id) {            // team: 1 vermelho, 2 azul -> retorna slot
    const s = w.s;
    let slot = s.players.findIndex(p => !p.present);
    const p = { present: true, id: id || 0, team, x: -100, y: -100, vx: 0, vy: 0, r: PLAYER_R, mass: w.cfg.pp.density,
      kickBuf: 0, passBuf: 0, lock: 0, lastAct: 0, ix: 0, iy: 0 };
    if (slot < 0) { slot = s.players.length; s.players.push(p); } else s.players[slot] = p;
    placeTeam(w);
    return slot;
  }
  function removePlayer(w, slot) {
    const p = w.s.players[slot];
    if (p) { p.present = false; p.x = p.y = -100; p.vx = p.vy = 0; }
    placeTeam(w);
  }
  function setTeam(w, slot, team) {
    const p = w.s.players[slot];
    if (p) { p.team = team; placeTeam(w); }
  }

  // formação de saída: 1 jogador por time = posição original do jogo (1.35 da linha de fundo)
  function formation(cfg, team, k, n) {
    const x = n === 1 ? (team === 1 ? cfg.bx0 + 1.35 : cfg.bx1 - 1.35)
      : (team === 1 ? cfg.cx - Math.max(2.2, (cfg.bx1 - cfg.bx0) * 0.18) : cfg.cx + Math.max(2.2, (cfg.bx1 - cfg.bx0) * 0.18));
    const span = (cfg.by1 - cfg.by0) * 0.7;
    const y = n === 1 ? cfg.cy : cfg.cy - span / 2 + span * (k / (n - 1));
    return { x: fr(x), y: fr(y) };
  }
  // reposiciona só quem ainda não entrou em campo OU todos (kickoff). all=true reposiciona todos.
  function placeTeam(w, all) {
    const s = w.s, cfg = w.cfg;
    for (const team of [1, 2]) {
      const mem = s.players.filter(p => p.present && p.team === team);
      mem.forEach((p, k) => {
        if (all || p.x < -50) { const f = formation(cfg, team, k, mem.length); p.x = f.x; p.y = f.y; p.vx = p.vy = 0; }
      });
    }
  }
  function resetPositions(w) {
    const s = w.s, cfg = w.cfg;
    placeTeam(w, true);
    s.ball.x = fr(cfg.cx); s.ball.y = fr(cfg.cy); s.ball.vx = s.ball.vy = 0;
    s.restart = null; s.lastTouchTeam = 0; s.lastTouchSlot = -1;
  }

  /* ---------- colisões ---------- */
  function collide(a, b, rest) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = len(dx, dy) || 0.0001, min = a.r + b.r;
    if (d >= min) return;
    const nx = dx / d, ny = dy / d, pen = min - d;
    a.x -= nx * pen * (b.mass / (a.mass + b.mass)); a.y -= ny * pen * (b.mass / (a.mass + b.mass));
    b.x += nx * pen * (a.mass / (a.mass + b.mass)); b.y += ny * pen * (a.mass / (a.mass + b.mass));
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv > 0) return;
    const j = -(1 + rest) * rv / (1 / a.mass + 1 / b.mass);
    a.vx -= j * nx / a.mass; a.vy -= j * ny / a.mass;
    b.vx += j * nx / b.mass; b.vy += j * ny / b.mass;
  }
  function collideStatic(b, cx, cy, cr, rest) {
    const dx = b.x - cx, dy = b.y - cy;
    const d = len(dx, dy) || 0.0001, min = b.r + cr;
    if (d >= min) return false;
    const nx = dx / d, ny = dy / d;
    b.x = cx + nx * min; b.y = cy + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= (1 + rest) * vn * nx; b.vy -= (1 + rest) * vn * ny; }
    return true;
  }
  const inGoal = (cfg, y, gs) => {
    const g = gs[0]; if (!g) return false;
    return y >= g.y1 + cfg.postR && y <= g.y2 - cfg.postR;
  };
  function emit(w, type, a, b, c, d) { w.events.push({ type, tick: w.s.tick, a, b, c, d }); }

  // rede/fundo do gol: freia a bola e a segura (parte física; o visual da rede é feito pelo cliente via eventos NET)
  function goalNetPhysics(w, dt) {
    const b = w.s.ball;
    for (let i = 0; i < w.cfg.nets.length; i++) {
      const n = w.cfg.nets[i];
      const u = n.dir * (b.x - n.x0);
      if (u <= 0 || b.y < n.y1 - b.r || b.y > n.y2 + b.r) continue;
      const drag = 1 - 2.8 * dt + 2.8 * 2.8 * dt * dt / 2;  // ~exp(-2.8dt) sem usar exp
      b.vx *= drag; b.vy *= drag;
      if (b.y - b.r < n.y1) { b.y = n.y1 + b.r; if (b.vy < 0) { emit(w, EV.NET, i, 1, -b.vy, u); b.vy = -b.vy * 0.22; } }
      if (b.y + b.r > n.y2) { b.y = n.y2 - b.r; if (b.vy > 0) { emit(w, EV.NET, i, 2, b.vy, u); b.vy = -b.vy * 0.22; } }
      if (u + b.r > n.depth) {
        b.x = n.x0 + n.dir * (n.depth - b.r);
        const vn = n.dir * b.vx;
        if (vn > 0) { emit(w, EV.NET, i, 0, vn, b.y); b.vx = -n.dir * vn * 0.16; }
      }
    }
  }

  /* ---------- um tick de física de jogo (fase PLAY) ---------- */
  function physics(w, inputs, dt) {
    const s = w.s, cfg = w.cfg, pp = cfg.pp, bp = cfg.bp, b = s.ball, P = s.players;

    // 1) entrada -> velocidade (o jogo original define a velocidade direto, sem aceleração)
    for (let i = 0; i < P.length; i++) {
      const p = P[i]; if (!p.present) continue;
      const inp = inputs[i];
      let ix = 0, iy = 0;
      if (inp) { ix = inp.x | 0; iy = inp.y | 0; }
      const l = len(ix, iy);
      p.ix = ix; p.iy = iy;
      if (l > 6) { p.vx = ix / l * MOVE_SPEED; p.vy = iy / l * MOVE_SPEED; } else { p.vx = 0; p.vy = 0; }
      if (inp && inp.kick) p.kickBuf = KICK_BUFFER;
      if (inp && inp.pass) p.passBuf = KICK_BUFFER;
    }
    const damp = Math.max(0, 1 - pp.damping * dt), bd = Math.max(0, 1 - bp.damping * dt);
    for (const p of P) { if (!p.present) continue; p.vx *= damp; p.vy *= damp;
      const sp = len(p.vx, p.vy); if (sp > MAX_SPEED) { p.vx = p.vx / sp * MAX_SPEED; p.vy = p.vy / sp * MAX_SPEED; } }
    b.vx *= bd; b.vy *= bd;
    for (const p of P) if (p.present) { p.x += p.vx * dt; p.y += p.vy * dt; }
    b.x += b.vx * dt; b.y += b.vy * dt;
    for (const p of P) if (p.present) {
      p.x = Math.max(p.r, Math.min(cfg.pw - p.r, p.x)); p.y = Math.max(p.r, Math.min(cfg.ph - p.r, p.y));
    }

    // 2) paredes da bola (futsal)
    const clampBallWalls = () => {
      if (cfg.real) return;
      if (b.y - b.r < cfg.by0) { b.y = cfg.by0 + b.r; b.vy = Math.abs(b.vy) * 0.55; }
      if (b.y + b.r > cfg.by1) { b.y = cfg.by1 - b.r; b.vy = -Math.abs(b.vy) * 0.55; }
      const lgw = inGoal(cfg, b.y, cfg.left), rgw = inGoal(cfg, b.y, cfg.right);
      if (b.x - b.r < cfg.bx0 && !lgw) { b.x = cfg.bx0 + b.r; b.vx = Math.abs(b.vx) * 0.55; }
      if (b.x + b.r > cfg.bx1 && !rgw) { b.x = cfg.bx1 - b.r; b.vx = -Math.abs(b.vx) * 0.55; }
    };
    const fixBallAgainstWall = q => {
      if (cfg.real) return;
      clampBallWalls();
      const ddx = b.x - q.x, ddy = b.y - q.y, dd = len(ddx, ddy) || 0.0001, need = q.r + b.r;
      if (dd < need) {
        const pen = need - dd;
        q.x -= ddx / dd * pen; q.y -= ddy / dd * pen;
        q.x = Math.max(q.r, Math.min(cfg.pw - q.r, q.x)); q.y = Math.max(q.r, Math.min(cfg.ph - q.r, q.y));
      }
    };
    clampBallWalls();
    const lg = inGoal(cfg, b.y, cfg.left), rg = inGoal(cfg, b.y, cfg.right);
    const L0 = cfg.left[0], R0 = cfg.right[0];
    const leftBack = L0 ? L0.x1 - cfg.goalDepth : cfg.bx0, rightBack = R0 ? R0.x1 + cfg.goalDepth : cfg.bx1;
    for (const q of P) { if (!q.present) continue;
      if (L0 && q.y >= L0.y1 && q.y <= L0.y2 && q.x < L0.x1 && q.x - q.r < leftBack) q.x = leftBack + q.r;
      if (R0 && q.y >= R0.y1 && q.y <= R0.y2 && q.x > R0.x1 && q.x + q.r > rightBack) q.x = rightBack - q.r;
    }
    // 3) gol
    let scored = 0;
    if (lg && L0 && b.x + b.r < L0.x1) scored = 2;       // bola no gol da esquerda: ponto do azul
    else if (rg && R0 && b.x - b.r > R0.x1) scored = 1;  // ponto do vermelho
    if (scored) {
      if (scored === 1) s.red++; else s.blue++;
      s.phase = PH.GOAL; s.goalT = 0; s.goalTeam = scored;
      if (cfg.arbitration) s.restartTeam = s.barrierTeam = scored === 1 ? 2 : 1;
      if (cfg.arbitration && s.overtime && cfg.goldenGoal) s.phase = PH.ENDED;
      s.lastScorer = s.lastTouchTeam === scored ? s.lastTouchSlot : -1;
      for (const p of P) if (p.present) { p.vx = 0; p.vy = 0; }
      emit(w, EV.GOAL, scored, s.red, s.blue, s.lastScorer);
    }
    // 4) traves
    const postRest = Math.min(0.88, Math.max(0.8, bp.restitution + 0.08));
    for (let i = 0; i < cfg.nets.length; i++) {
      const n = cfg.nets[i];
      for (let k = 0; k < 2; k++) {
        const pt = n.post[k], sp = len(b.vx, b.vy);
        if (collideStatic(b, pt.x, pt.y, n.pr, postRest)) {
          emit(w, EV.POST, i, k, sp);
        }
      }
    }
    goalNetPhysics(w, dt);
    // jogadores x traves / laterais da rede
    for (const q of P) { if (!q.present) continue;
      for (const n of cfg.nets) {
        for (const pt of n.post) collideStatic(q, pt.x, pt.y, n.pr, 0.15);
        const u = n.dir * (q.x - n.x0);
        if (u > q.r * 0.9 && q.y > n.y1 && q.y < n.y2) {
          q.y = Math.max(n.y1 + q.r, Math.min(n.y2 - q.r, q.y));
          if (u + q.r > n.depth) { q.x = n.x0 + n.dir * (n.depth - q.r); if (n.dir * q.vx > 0) q.vx = 0; }
        }
      }
    }
    if (s.phase === PH.GOAL) { sanitize(s); return; }
    // 5) jogador x bola, jogador x jogador
    const rest = (pp.restitution + bp.restitution) / 2;
    for (const p of P) { if (!p.present) continue; collide(p, b, rest); fixBallAgainstWall(p); }
    for (let i = 0; i < P.length; i++) { if (!P[i].present) continue;
      for (let j = i + 1; j < P.length; j++) { if (P[j].present) collide(P[i], P[j], pp.restitution); } }
    // 6) chute / passe (uma ação por contato; chute tem prioridade; trava entre tipos diferentes)
    for (let i = 0; i < P.length; i++) {
      const p = P[i]; if (!p.present) continue;
      if (p.kickBuf > 0) p.kickBuf--; if (p.passBuf > 0) p.passBuf--; if (p.lock > 0) p.lock--;
      if (p.lock > 0) { if (p.lastAct === 1) p.passBuf = 0; else p.kickBuf = 0; }
      if (p.kickBuf > 0 || p.passBuf > 0) {
        const dx = b.x - p.x, dy = b.y - p.y, d = len(dx, dy) || 1;
        if (d < p.r + b.r + KICK_REACH) {
          const mult = p.kickBuf > 0 ? 2.05 : 1.48;
          p.lastAct = p.kickBuf > 0 ? 1 : 2;
          const amount = (pp.impulseWithKick * 2.62 * dt * 60 + bp.ballPower * 40.0) * mult;
          b.vx += dx / d * amount / b.mass; b.vy += dy / d * amount / b.mass;
          p.kickBuf = 0; p.passBuf = 0; p.lock = ACTION_LOCK;
          s.lastTouchTeam = p.team; s.lastTouchSlot = i;
          emit(w, EV.KICK, i, p.lastAct);
        }
      }
    }
    if (cfg.real) realRules(w, dt, lg, rg);
    sanitize(s);
  }

  function sanitize(s) {   // arredonda para float32: servidor e cliente ficam bit a bit iguais ao snapshot
    const b = s.ball; b.x = fr(b.x); b.y = fr(b.y); b.vx = fr(b.vx); b.vy = fr(b.vy);
    for (const p of s.players) if (p.present) { p.x = fr(p.x); p.y = fr(p.y); p.vx = fr(p.vx); p.vy = fr(p.vy); }
  }

  /* ---------- Real Soccer: lateral, escanteio, tiro de meta (sem falta/impedimento) ---------- */
  function realRules(w, dt, lg, rg) {
    const s = w.s, cfg = w.cfg, b = s.ball, P = s.players;
    const { bx0, bx1, by0, by1, cx, cy } = cfg, W = bx1 - bx0;
    const other = t => (t === 1 ? 2 : 1);
    for (let i = 0; i < P.length; i++) {
      const p = P[i]; if (!p.present) continue;
      if (len(b.x - p.x, b.y - p.y) <= p.r + b.r + 0.2) { s.lastTouchTeam = p.team; s.lastTouchSlot = i; }
    }
    const r = s.restart;
    if (r) {
      let taker = -1;
      for (let i = 0; i < P.length; i++) { const p = P[i];
        if (p.present && p.team === r.team && len(b.x - p.x, b.y - p.y) <= p.r + b.r + 0.12) { taker = i; break; } }
      if (taker >= 0) { s.restart = null; s.lastTouchTeam = r.team; s.lastTouchSlot = taker; return; }
      const hasTaker = P.some(p => p.present && p.team === r.team);
      r.t++;
      if (!hasTaker && r.t >= AUTO_RESTART_TICKS) {
        const dx = cx - b.x, dy = cy - b.y, d = len(dx, dy) || 1, sp = r.type === 2 ? 9 : 7;
        b.vx = dx / d * sp; b.vy = dy / d * sp; s.lastTouchTeam = r.team; s.restart = null;
        emit(w, EV.KICK, -1, 0); return;
      }
      b.x = r.x; b.y = r.y; b.vx = b.vy = 0;
      for (const p of P) { if (!p.present || p.team === r.team) continue;       // adversários ficam a 4 m da bola
        const R = 4, dx = p.x - r.x, dy = p.y - r.y, d = len(dx, dy) || 0.001;
        if (d < R) { p.x = r.x + dx / d * R; p.y = r.y + dy / d * R;
          p.x = Math.max(p.r, Math.min(cfg.pw - p.r, p.x)); p.y = Math.max(p.r, Math.min(cfg.ph - p.r, p.y)); } }
      return;
    }
    const last = s.lastTouchTeam || 1;
    const start = (type, team, x, y) => {      // type: 1 lateral, 2 tiro de meta, 3 escanteio
      s.restart = { type, team, x, y, t: 0 };
      b.x = x; b.y = y; b.vx = b.vy = 0; s.lastTouchTeam = 0; s.lastTouchSlot = -1;
      emit(w, EV.RESTART, type, team);
    };
    const goalDepth = W * (5.5 / 105);
    const outLeft = b.x + b.r < bx0 && !lg, outRight = b.x - b.r > bx1 && !rg;
    if (outLeft || outRight) {
      const defender = outLeft ? 1 : 2, attacker = other(defender);
      if (last === defender) start(3, attacker, outLeft ? bx0 + 0.2 : bx1 - 0.2, b.y < cy ? by0 + 0.2 : by1 - 0.2);
      else start(2, defender, outLeft ? bx0 + goalDepth * 0.8 : bx1 - goalDepth * 0.8, cy);
    } else if (b.y + b.r < by0 || b.y - b.r > by1) {
      const top = b.y < cy;
      start(1, other(last), Math.max(bx0 + 0.6, Math.min(bx1 - 0.6, b.x)), top ? by0 : by1);
    }
  }

  /* ---------- tick completo (todas as fases) ---------- */
  function checkEnd(w) {
    const s = w.s;
    if (s.red >= w.cfg.scoreLimit || s.blue >= w.cfg.scoreLimit) {
      s.phase = PH.ENDED; emit(w, EV.END, s.red, s.blue);
      return true;
    }
    if (s.timeTicks <= 0) {
      if (w.cfg.arbitration && w.cfg.overtimeTicks > 0 && s.red === s.blue && !s.overtime) {
        s.overtime = true; s.timeTicks = w.cfg.overtimeTicks; s.cd = COUNTDOWN_TICKS; s.barrierTeam = 0;
        emit(w, EV.WHISTLE, 2, s.timeTicks);
        return false;
      }
      s.phase = PH.ENDED; emit(w, EV.END, s.red, s.blue); return true;
    }
    return false;
  }
  function step(w, inputs) {
    const s = w.s, dt = TICK_DT;
    s.tick++;
    if (s.phase === PH.COUNTDOWN) {
      for (const p of s.players) if (p.present) { p.vx = 0; p.vy = 0; }
      s.ball.x = fr(w.cfg.cx); s.ball.y = fr(w.cfg.cy); s.ball.vx = s.ball.vy = 0;
      if (w.cfg.arbitration && s.barrierTeam) {
        for (const p of s.players) if (p.present && p.team === s.barrierTeam) {
          if (p.team === 1) p.x = Math.min(p.x, w.cfg.cx - p.r);
          else p.x = Math.max(p.x, w.cfg.cx + p.r);
        }
      }
      if (--s.cd <= 0) { s.phase = PH.PLAY; s.barrierTeam = 0; emit(w, EV.WHISTLE, s.overtime ? 2 : 0); }
    } else if (s.phase === PH.PLAY) {
      s.timeTicks--;
      if (s.timeTicks <= 0) { s.timeTicks = 0; checkEnd(w); }
      else physics(w, inputs, dt);
    } else if (s.phase === PH.GOAL) {
      s.goalT++;
      const b = s.ball, bd = Math.max(0, 1 - w.cfg.bp.damping * dt);
      b.vx *= bd; b.vy *= bd; b.x += b.vx * dt; b.y += b.vy * dt;
      goalNetPhysics(w, dt); sanitize(s);
      if (s.goalT >= GOAL_PAUSE_TICKS) {
        resetPositions(w);
        if (!checkEnd(w)) {
          if (w.cfg.arbitration) { s.cd = COUNTDOWN_TICKS; s.phase = PH.COUNTDOWN; }
          else s.phase = PH.PLAY;
        }
      }
    }
    return w;
  }

  /* ---------- clone / restore do estado dinâmico (rollback do cliente) ---------- */
  function cloneState(s) {
    return {
      tick: s.tick, phase: s.phase, cd: s.cd, timeTicks: s.timeTicks, red: s.red, blue: s.blue, goalT: s.goalT,
      goalTeam: s.goalTeam, lastScorer: s.lastScorer, lastTouchTeam: s.lastTouchTeam, lastTouchSlot: s.lastTouchSlot,
      restartTeam: s.restartTeam, barrierTeam: s.barrierTeam, overtime: !!s.overtime,
      restart: s.restart ? { type: s.restart.type, team: s.restart.team, x: s.restart.x, y: s.restart.y, t: s.restart.t } : null,
      ball: { x: s.ball.x, y: s.ball.y, vx: s.ball.vx, vy: s.ball.vy, r: s.ball.r, mass: s.ball.mass },
      players: s.players.map(p => ({ present: p.present, id: p.id, team: p.team, x: p.x, y: p.y, vx: p.vx, vy: p.vy, r: p.r, mass: p.mass,
        kickBuf: p.kickBuf, passBuf: p.passBuf, lock: p.lock, lastAct: p.lastAct, ix: p.ix, iy: p.iy }))
    };
  }

  return { TICK_RATE, TICK_DT, PH, EV, MOVE_SPEED, PLAYER_R, create, addPlayer, removePlayer, setTeam, resetPositions, step, cloneState,
    teamName, len };
});
