'use strict';
/* Servidor de partidas (headless): registro de salas, agendador de 60 Hz, WebSocket e REST das salas.
 * Roda no mesmo processo do server.js (sem dependências). Para escalar: um processo destes por região/CPU,
 * com o registro de salas em um serviço compartilhado (ver docs/MULTIPLAYER.md). */
const crypto = require('crypto');
const wsLib = require('./ws');
const { Room } = require('./room');

const MAX_ROOMS = +process.env.FUTHUB_MAX_ROOMS || 200;
const MAX_CONN = +process.env.FUTHUB_MAX_CONN || 2000;
const MAX_CONN_IP = +process.env.FUTHUB_MAX_CONN_IP || 12;
const HELLO_MS = 5000;
const TICK_NS = 1e9 / 60;

class GameServer {
  constructor(deps) {
    this.deps = deps || {};                 // { getUser(req) -> user|null, rateLimit(key,max,ms), onRankedEnd(room,result) }
    this.rooms = new Map(); this.conns = 0; this.perIp = new Map();
    this.stats = { started: Date.now(), ticksLate: 0, maxLateMs: 0, loops: 0 };
    this.next = process.hrtime.bigint();
    this._loop = this._loop.bind(this);
    this.timer = setTimeout(this._loop, 4);
    if (this.timer.unref) this.timer.unref();
  }
  /* ---------- agendador: 60 Hz com correção de deriva ---------- */
  _loop() {
    const now = process.hrtime.bigint();
    let n = 0;
    while (now >= this.next && n < 5) {                   // no máximo 5 ticks de recuperação por volta
      for (const r of this.rooms.values()) {
        try { r.tick(); } catch (e) { console.error('Erro na sala', r.id, e); r.closing = true; }
      }
      this.next += BigInt(Math.round(TICK_NS)); n++;
    }
    const late = Number(now - this.next) / 1e6;
    if (late > 100) { this.stats.ticksLate++; this.next = now; }       // travou por muito tempo: não tenta recuperar tudo
    if (late > this.stats.maxLateMs) this.stats.maxLateMs = late;
    this.stats.loops++;
    for (const [id, r] of this.rooms) {
      if (r.closing || (r.size === 0 && Date.now() - (r.emptySince || r.createdAt) > 15000 && !r.ranked) || (r.ranked && r.result && r.size === 0)) {
        r.destroy(); this.rooms.delete(id);
      }
    }
    const wait = Math.max(1, Number(this.next - process.hrtime.bigint()) / 1e6 - 1);
    this.timer = setTimeout(this._loop, wait);
    if (this.timer.unref) this.timer.unref();
  }

  /* ---------- salas ---------- */
  createRoom(o) {
    if (this.rooms.size >= MAX_ROOMS) return { error: 'Servidor cheio. Tente novamente em instantes.' };
    const id = crypto.randomBytes(5).toString('hex');
    const r = new Room(Object.assign({}, o, { id }), {
      onRankedEnd: (room, res) => this.deps.onRankedEnd && this.deps.onRankedEnd(room, res),
      saveReplay: this.deps.saveReplay,
      appVersion: this.deps.appVersion
    });
    this.rooms.set(id, r);
    return { room: r };
  }
  list() { return [...this.rooms.values()].filter(r => !r.ranked).map(r => r.listing()); }
  get(id) { return this.rooms.get(id); }

  /* ---------- WebSocket ---------- */
  upgrade(req, socket, head) {
    let url; try { url = new URL(req.url, 'http://x'); } catch (e) { return socket.destroy(); }
    if (url.pathname !== '/ws') return socket.destroy();
    const ip = (this.deps.ip && this.deps.ip(req)) || req.socket.remoteAddress || '?';
    if (this.conns >= MAX_CONN || (this.perIp.get(ip) || 0) >= MAX_CONN_IP) { socket.end('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return; }
    const verifyOrigin = rq => { const o = rq.headers.origin; if (!o) return true; try { return new URL(o).host === rq.headers.host; } catch (e) { return false; } };
    const user = this.deps.getUser ? this.deps.getUser(req) : null;
    this.conns++; this.perIp.set(ip, (this.perIp.get(ip) || 0) + 1);
    let released = false;
    const release = () => { if (released) return; released = true; this.conns--; const n = (this.perIp.get(ip) || 1) - 1; if (n > 0) this.perIp.set(ip, n); else this.perIp.delete(ip); };
    const c = wsLib.upgrade(req, socket, { maxPayload: 2048, verifyOrigin }, conn => {
      let seat = null;
      const hello = setTimeout(() => { if (!seat) conn.close(1008); }, HELLO_MS);
      conn.on('close', () => { clearTimeout(hello); release(); if (seat) seat.room.leave(seat.client, conn.cleanClose ? 'leave' : 'drop'); });
      conn.on('message', (data, bin) => {
        if (seat) return seat.room.onMessage(seat.client, data, bin);
        if (bin) return conn.close(1003);
        let m; try { m = JSON.parse(data); } catch (e) { return conn.close(1003); }
        if (!m || m.t !== 'hello') return conn.close(1008);
        const room = this.rooms.get(String(m.room || ''));
        if (!room) { conn.send(JSON.stringify({ t: 'bye', msg: 'Sala não encontrada.', gone: true })); return conn.close(1000); }
        const res = room.join(conn, { nick: (user && user.nick) || m.nick, avatar: (user && user.avatar) || m.avatar, user, password: m.password });
        if (res.error) { conn.send(JSON.stringify({ t: 'bye', msg: res.error })); return conn.close(1000); }
        clearTimeout(hello); seat = { room, client: res.client };
      });
    });
    if (!c) release();
  }

  /* ---------- diagnóstico ---------- */
  metrics() {
    const rooms = [...this.rooms.values()].map(r => ({ id: r.id, name: r.name, players: r.size, started: r.started, ranked: !!r.ranked,
      ticks: r.m.ticks, tickUsAvg: r.m.ticks ? +(r.m.tickNs / r.m.ticks / 1000).toFixed(1) : 0, tickUsMax: +(r.m.tickNsMax / 1000).toFixed(1),
      snapSent: r.m.snapSent, snapSkipped: r.m.snapSkipped, bytesSnap: r.m.bytesSnap, invalid: r.m.invalid, starved: r.m.starved, trimmed: r.m.trimmed,
      clients: [...r.clients.values()].map(c => ({ id: c.id, nick: c.nick, team: c.team, rtt: Math.round(c.rtt), jitter: Math.round(c.jitter), fps: Math.round(c.fps),
        q: c.queue.length, starved: c.stats.starved, trimmed: c.stats.trimmed })) }));
    const mu = process.memoryUsage();
    return { uptimeS: Math.round((Date.now() - this.stats.started) / 1000), conns: this.conns, rooms: this.rooms.size, maxLateMs: +this.stats.maxLateMs.toFixed(2),
      ticksLate: this.stats.ticksLate, rssMB: +(mu.rss / 1048576).toFixed(1), heapMB: +(mu.heapUsed / 1048576).toFixed(1), list: rooms };
  }
}
module.exports = { GameServer };
