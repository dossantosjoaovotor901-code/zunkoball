'use strict';
/* Simulador de rede em TEMPO VIRTUAL para testar o multiplayer do FutHub de forma determinística.
 *
 * Usa as classes reais: Room (servidor) e FHNet.Client (cliente). Só o transporte é simulado:
 *  - latência fixa + jitter + picos de latência programados;
 *  - perda de pacotes modelada como TCP/WebSocket de verdade: o pacote perdido é retransmitido depois de
 *    um RTO e BLOQUEIA os seguintes na mesma conexão (head-of-line blocking). Perda não some com dados.
 *  - cada cliente tem seu próprio FPS (e jitter de quadro).
 * Date.now() é substituído pelo relógio virtual enquanto o teste roda. */
const Sim = require('../game/sim.js');
const Proto = require('../game/proto.js');
const { Client } = require('../game/netclient.js');
const { Room, MAPS } = require('../server/room.js');

function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

class Link {           // uma direção de uma conexão (ordenada, como TCP)
  constructor(sim, profile, rand) { this.sim = sim; this.p = profile; this.rand = rand; this.q = []; this.lastDeliver = 0; this.sent = 0; this.bytes = 0; this.lost = 0; }
  push(data, bin, deliver) {
    const p = this.p, t = this.sim.t;
    let lat = p.oneWay + (this.rand() * 2 - 1) * p.jitter;
    for (const sp of (p.spikes || [])) if (t >= sp.from && t < sp.to) lat += sp.extra;
    lat = Math.max(1, lat);
    if (p.loss && this.rand() < p.loss) { lat += Math.max(200, 2 * p.oneWay * 2); this.lost++; }   // RTO de retransmissão
    let at = t + lat;
    if (at < this.lastDeliver) at = this.lastDeliver;                                                // HOL blocking / ordenação
    this.lastDeliver = at;
    this.q.push({ at, data, bin, deliver });
    this.sent++; this.bytes += typeof data === 'string' ? data.length : data.length;
  }
  pump() {
    const t = this.sim.t;
    while (this.q.length && this.q[0].at <= t) { const m = this.q.shift(); m.deliver(m.data, m.bin); }
  }
}

class NetSim {
  constructor(opts) {
    opts = opts || {};
    this.t = 1000; this.rand = rng(opts.seed || 7);
    this.realNow = Date.now; Date.now = () => this.t;
    this.links = []; this.clients = []; this.serverDown = false;
    this.room = new Room({ id: 'T', name: 'teste', mapKey: opts.map || 'v1', style: opts.style, scoreLimit: opts.scoreLimit || 20,
      timeLimit: opts.timeLimit || 5, max: 30, ranked: opts.ranked }, opts.env || {});
    this.nextTick = this.t; this.tickErr = 0;
    this.samples = { div: [], tickUs: [] };
  }
  close() { Date.now = this.realNow; }
  getMap(k) { return MAPS.MAPS[k]; }

  addClient(o) {   // o: { profile, fps, predict, behavior:'bot'|'idle'|'probe', nick, team, user }
    const sim = this, profile = o.profile || { oneWay: 10, jitter: 0, loss: 0 };
    const up = new Link(this, profile, this.rand), down = new Link(this, profile, this.rand);
    const c = { sim: this, o, up, down, nick: o.nick || 'P' + this.clients.length, frameAt: this.t + this.rand() * 16, fps: o.fps || 60,
      rand: rng(1000 + this.clients.length * 17), log: { probe: [], frames: 0 }, connected: false, stuck: 0, id: this.clients.length };
    const conn = {                                   // lado servidor
      buffered: 0, bytesOut: 0,
      send: (d) => { if (!c.connected) return; conn.bytesOut += d.length; down.push(d, typeof d !== 'string', (x, b) => c.net.onMessage(b ? new Uint8Array(x) : x, b)); },
      close: () => { c.connected = false; }
    };
    c.conn = conn;
    c.net = new Client({
      now: () => this.t,
      send: (d) => { if (c.connected) up.push(d, typeof d !== 'string', (x, b) => { if (c.sc && !this.serverDown) this.room.onMessage(c.sc, b ? new Uint8Array(x) : x, b); }); },
      getMap: k => this.getMap(k),
      input: () => c.inputNow(),
      onEvent: e => { c.events = (c.events || 0) + 1; }
    }, { predict: o.predict !== false });
    c.inputNow = () => behavior(c);
    c.join = () => {
      c.connected = true;
      const r = this.room.join(conn, { nick: c.nick, user: o.user || null });
      if (r.error) { c.connected = false; throw new Error(r.error); }
      c.sc = r.client; return r.client;
    };
    c.join();
    if (o.team != null) this.room.onMessage(c.sc, JSON.stringify({ t: 'team', team: o.team }), false);
    this.clients.push(c); this.links.push(up, down);
    return c;
  }
  dropClient(c) { c.connected = false; this.room.leave(c.sc); }

  // roda `ms` de tempo virtual
  run(ms) {
    const end = this.t + ms, TICK = 1000 / 60;
    while (this.t < end) {
      this.t += 1;                                              // passo de 1 ms
      for (const l of this.links) l.pump();
      if (!this.serverDown) {
        while (this.t >= this.nextTick) {
          const t0 = process.hrtime.bigint(); this.room.tick(); this.samples.tickUs.push(Number(process.hrtime.bigint() - t0) / 1000);
          this.nextTick += TICK;
        }
      } else this.nextTick = this.t + TICK;
      for (const c of this.clients) {
        if (!c.connected || this.t < c.frameAt) continue;
        const dt = 1000 / c.fps, step = dt + (c.o.frameJitter ? (c.rand() - .5) * c.o.frameJitter : 0);
        c.frameAt += Math.max(1, step);
        c.net.frame(step); c.log.frames++;
        if (c.o.behavior === 'probe') probe(c);
      }
    }
  }
}

/* ---------- comportamentos ---------- */
function behavior(c) {
  const kind = c.o.behavior || 'bot', n = c.net;
  if (kind === 'idle' || !n.w) return { x: 0, y: 0 };
  if (kind === 'probe') return c.probeInput || { x: 0, y: 0 };
  const st = n.w.s, me = st.players[n.slot], b = st.ball;
  if (!me) return { x: 0, y: 0 };
  // bot simples: vai atrás da bola (por trás, em direção ao gol rival) e chuta quando encosta
  const goalX = me.team === 1 ? n.w.cfg.bx1 : n.w.cfg.bx0, gy = n.w.cfg.cy;
  const ux = goalX - b.x, uy = gy - b.y, ul = Math.sqrt(ux * ux + uy * uy) || 1;
  const tx = b.x - ux / ul * 0.9, ty = b.y - uy / ul * 0.9;
  let dx = tx - me.x, dy = ty - me.y, dl = Math.sqrt(dx * dx + dy * dy);
  if (dl < 0.15) { dx = b.x - me.x; dy = b.y - me.y; dl = Math.sqrt(dx * dx + dy * dy) || 1; }
  const near = Math.sqrt((b.x - me.x) ** 2 + (b.y - me.y) ** 2) < me.r + b.r + 0.14;
  if (near && c.rand() < 0.5) n.pressKick();
  const wob = (c.rand() - .5) * 0.3;
  return { x: Math.round(dx / dl * 127 + wob * 127), y: Math.round(dy / dl * 127) };
}
// sonda de latência: alterna parado/andando; mede o tempo até a posição RENDERIZADA do próprio jogador se mexer
function probe(c) {
  const n = c.net, s = c.sim, r = n.getRender(); if (!r || n.slot < 0) return;
  const px = r.pos[2 + 2 * n.slot], py = r.pos[3 + 2 * n.slot];
  const sp = s.room.world.s.players[c.sc.slot];                        // verdade no servidor
  const P = c.probe || (c.probe = { phase: 'rest', t0: s.t + 5500, base: null, dir: 1, done: [], blocked: 0 });
  const finish = () => { P.phase = 'run'; P.t1 = s.t + 700; };
  (P.trail = P.trail || []).push([s.t, px, py, sp.x, sp.y]); while (P.trail.length > 40) P.trail.shift();
  const old = P.trail.find(q => s.t - q[0] <= 220 && s.t - q[0] >= 150);
  const still = old && Math.hypot(old[1] - px, old[2] - py) < 0.004 && Math.hypot(old[3] - sp.x, old[4] - sp.y) < 0.004;   // parado antes de apertar
  if (P.phase === 'rest' && s.t >= P.t0 && !still) { /* espera ficar parado */ }
  else if (P.phase === 'rest' && s.t >= P.t0) {
    P.phase = 'wait'; P.press = s.t; P.base = [px, py]; P.sbase = [sp.x, sp.y]; P.sMoved = null;
    P.dir = Math.abs(px - n.w.cfg.cx) > 1.5 ? (px < n.w.cfg.cx ? 1 : -1) : P.dir;      // anda sempre para onde há espaço
    c.probeInput = { x: 127 * P.dir, y: 0 };
  } else if (P.phase === 'wait') {
    if (P.sMoved == null && Math.hypot(sp.x - P.sbase[0], sp.y - P.sbase[1]) >= 0.03) P.sMoved = s.t - P.press;
    if (P.cMoved == null && Math.hypot(px - P.base[0], py - P.base[1]) >= 0.03) P.cMoved = s.t - P.press;
    // válida só se o servidor também andou logo (se a bola prende o jogador na parede, o servidor não anda: não é latência de rede)
    if (P.cMoved != null && P.sMoved != null) { if (P.sMoved < 400) P.done.push(P.cMoved); else P.blocked++; P.cMoved = null; finish(); }
    else if (s.t - P.press > 1500) { P.blocked++; P.cMoved = null; finish(); }
  } else if (P.phase === 'run' && s.t >= P.t1) { c.probeInput = { x: 0, y: 0 }; P.phase = 'rest'; P.t0 = s.t + 1500; P.dir *= -1; }
}

const pct = (a, p) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
module.exports = { NetSim, Link, rng, pct, avg, Sim, Proto };
