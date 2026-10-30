'use strict';
/* Replay do FutHub (sem dependencias).
 *
 * - Recorder: grava uma partida ONLINE a partir do estado AUTORITATIVO do servidor
 *   (game/sim.js), amostrando quadros a uma cadencia fixa e registrando os eventos
 *   (gol, apito, trave, rede, lateral, etc.). Produz o formato .fhreplay (JSON versionado),
 *   que tambem e gerado identicamente pelo cliente para partidas offline (contra IA).
 * - ReplayStore: guarda cada replay em disco (data/replays/<id>.fhreplay) e mantem apenas
 *   um indice leve em memoria/db (sem os quadros), com limites por jogador e globais.
 *   Evita manter todos os dados de partidas antigas na memoria.
 *
 * O mesmo formato e lido pelo player do cliente (game/replay.js), que reconstroi o
 * "engine" e desenha com draw() do game.js. Funciona 100% offline depois de baixado.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FORMAT_VERSION = 1;
const MAGIC = 'FHREPLAY';
const TICK_RATE = 60;

/* ---- limites configuraveis por ambiente ---- */
const SAMPLE_EVERY = Math.max(1, +process.env.FUTHUB_REPLAY_SAMPLE || 3);          // 1 quadro a cada 3 ticks (20 Hz)
const MAX_TICKS = +process.env.FUTHUB_REPLAY_MAX_TICKS || 60 * 60 * 45;            // teto de duracao (~45 min)
const MAX_FRAMES = +process.env.FUTHUB_REPLAY_MAX_FRAMES || 60000;
const MAX_EVENTS = +process.env.FUTHUB_REPLAY_MAX_EVENTS || 30000;
const MIN_TICKS = +process.env.FUTHUB_REPLAY_MIN_TICKS || 60 * 6;                  // descarta partidas < 6 s (abandono imediato)
const MAX_BYTES = +process.env.FUTHUB_REPLAY_MAX_BYTES || 8 * 1024 * 1024;         // 8 MB por arquivo
const MAX_PER_USER = +process.env.FUTHUB_REPLAY_MAX_PER_USER || 50;
const MAX_TOTAL = +process.env.FUTHUB_REPLAY_MAX_TOTAL || 3000;

const r3 = v => Math.round((v || 0) * 1000) / 1000;
const r2 = v => Math.round((v || 0) * 100) / 100;

/* =========================================================================
 * Recorder: grava uma partida a partir do estado da simulacao (servidor).
 * ========================================================================= */
class Recorder {
  constructor(meta) {
    this.meta = Object.assign({ map: 'v3', style: 'futsal', scoreLimit: 5, timeLimit: 5, mode: 'online', ranked: false }, meta || {});
    this.frames = [];
    this.events = [];
    this.rosterLog = [];
    this.userIds = new Set();
    this.startTick = null;
    this.lastSampleTick = -1;
    this.lastTick = 0;
    this.ended = false;
    this.overflow = false;
    this.endReason = null;
    this.finalScore = { red: 0, blue: 0 };
    this.startedAt = Date.now();
    this.endedAt = 0;
  }
  addUser(uid) { if (uid) this.userIds.add(String(uid)); }

  /* snapshot do elenco (slot -> {nick,av,team}); registrado quando muda */
  roster(players, tick) {
    if (this.ended) return;
    const slots = {};
    for (const p of players) {
      if (p.slot == null || p.slot < 0) continue;
      slots[p.slot] = { nick: String(p.nick || ''), av: String(p.av || p.avatar || ''), team: p.team | 0 };
      if (p.uid) this.addUser(p.uid);
    }
    const at = tick != null ? tick : this.lastTick;
    const prev = this.rosterLog[this.rosterLog.length - 1];
    if (!prev || JSON.stringify(prev.slots) !== JSON.stringify(slots)) this.rosterLog.push({ tick: at, slots });
  }

  /* amostra o estado autoritativo da simulacao (s = world.s) */
  sample(s, force) {
    if (this.ended || this.overflow) return;
    const tick = s.tick | 0;
    this.lastTick = tick;
    if (this.startTick == null) this.startTick = tick;
    if (tick - this.startTick > MAX_TICKS) { this.overflow = true; return; }
    if (!force && this.lastSampleTick >= 0 && tick - this.lastSampleTick < SAMPLE_EVERY) return;
    if (force && this.lastSampleTick === tick) return;
    if (this.frames.length >= MAX_FRAMES) { this.overflow = true; return; }
    this.lastSampleTick = tick;
    const ps = [];
    for (let i = 0; i < s.players.length; i++) {
      const p = s.players[i];
      if (!p || !p.present) continue;
      ps.push([i, p.team | 0, r3(p.x), r3(p.y), r3(p.vx), r3(p.vy), p.ix | 0, p.iy | 0]);
    }
    const f = {
      t: tick, ph: s.phase | 0, r: s.red | 0, bl: s.blue | 0, tt: s.timeTicks | 0, cd: s.cd | 0,
      gt: s.goalT | 0, gtm: s.goalTeam | 0, ls: s.lastScorer == null ? -1 : s.lastScorer | 0,
      b: [r3(s.ball.x), r3(s.ball.y), r3(s.ball.vx), r3(s.ball.vy)], p: ps
    };
    if (s.restart) f.rs = { type: s.restart.type | 0, team: s.restart.team | 0, x: r3(s.restart.x), y: r3(s.restart.y), t: s.restart.t | 0 };
    this.frames.push(f);
  }

  /* evento da simulacao: [type, tick, a, b, c, d] */
  event(e) {
    if (this.ended || this.overflow || !e) return;
    if (this.events.length >= MAX_EVENTS) return;
    this.events.push([e[0] | 0, e[1] | 0, e[2] | 0, e[3] | 0, r2(e[4]), r2(e[5])]);
  }

  finalize(reason, score) {
    if (this.ended) return this;
    this.ended = true;
    this.endReason = reason || 'normal';
    if (score) this.finalScore = { red: score.red | 0, blue: score.blue | 0 };
    else if (this.frames.length) { const l = this.frames[this.frames.length - 1]; this.finalScore = { red: l.r, blue: l.bl }; }
    this.endedAt = Date.now();
    return this;
  }

  durationTicks() {
    if (!this.frames.length) return 0;
    return this.frames[this.frames.length - 1].t - this.frames[0].t;
  }
  hasEnough() { return this.frames.length >= 2 && this.durationTicks() >= MIN_TICKS; }

  /* monta o objeto .fhreplay serializavel */
  build() {
    const slots = (this.rosterLog[this.rosterLog.length - 1] || { slots: {} }).slots;
    const participants = [], teams = { red: [], blue: [] };
    for (const k of Object.keys(slots)) {
      const v = slots[k];
      participants.push({ slot: +k, nick: v.nick, avatar: v.av, team: v.team });
      (v.team === 2 ? teams.blue : teams.red).push(v.nick || 'Jogador');
    }
    const dur = this.durationTicks();
    return {
      magic: MAGIC, formatVersion: FORMAT_VERSION, kind: this.meta.mode === 'online' ? 'online' : 'offline',
      app: 'ZunkoBall', appVersion: this.meta.appVersion || '', tickRate: TICK_RATE, sampleEvery: SAMPLE_EVERY,
      match: {
        id: this.meta.id || null, map: this.meta.map, style: this.meta.style,
        scoreLimit: this.meta.scoreLimit | 0, timeLimit: this.meta.timeLimit | 0,
        mode: this.meta.mode, ranked: !!this.meta.ranked,
        startedAt: this.startedAt, endedAt: this.endedAt || Date.now(), end: this.endReason || 'normal'
      },
      teams, participants, finalScore: this.finalScore,
      durationTicks: dur, durationSec: Math.round(dur / TICK_RATE),
      roster: this.rosterLog, frames: this.frames, events: this.events
    };
  }
}

/* valida um objeto .fhreplay (usado no import e na leitura) */
function validate(obj) {
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'Arquivo vazio ou invalido.' };
  if (obj.magic !== MAGIC) return { ok: false, error: 'Nao e um arquivo de replay do ZunkoBall.' };
  if (!(obj.formatVersion >= 1 && obj.formatVersion <= FORMAT_VERSION)) return { ok: false, error: 'Versao de replay incompativel.' };
  if (!Array.isArray(obj.frames) || !obj.frames.length) return { ok: false, error: 'Replay sem quadros.' };
  if (obj.frames.length > MAX_FRAMES + 10) return { ok: false, error: 'Replay grande demais.' };
  if (!Array.isArray(obj.events)) return { ok: false, error: 'Replay sem eventos.' };
  if (!obj.match || typeof obj.match !== 'object') return { ok: false, error: 'Replay sem metadados.' };
  const f0 = obj.frames[0];
  if (!f0 || !Array.isArray(f0.b) || !Array.isArray(f0.p)) return { ok: false, error: 'Quadro invalido.' };
  return { ok: true };
}

/* =========================================================================
 * ReplayStore: persistencia em disco + indice leve no db (sem quadros).
 * db.replays[id] = { id, file, size, createdAt, meta..., userIds:[...] }
 * ========================================================================= */
const safeId = s => /^[a-zA-Z0-9_-]{1,40}$/.test(String(s || '')) ? String(s) : null;

class ReplayStore {
  constructor(opts) {
    opts = opts || {};
    this.dir = opts.dir || path.join(__dirname, '..', 'data', 'replays');
    this.db = opts.db || {};
    this.save = typeof opts.save === 'function' ? opts.save : () => {};
    if (!this.db.replays) this.db.replays = {};
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch (e) {}
    this._reconcile();
  }
  /* remove do indice entradas cujo arquivo sumiu (ex.: apagado a mao) */
  _reconcile() {
    for (const id of Object.keys(this.db.replays)) {
      const r = this.db.replays[id];
      if (!r || !r.file || !fs.existsSync(path.join(this.dir, r.file))) delete this.db.replays[id];
    }
  }
  _file(id) { return path.join(this.dir, id + '.fhreplay'); }

  /* grava um Recorder finalizado. Retorna a entrada de indice ou null (descartado). */
  put(rec) {
    if (!rec || !rec.hasEnough()) return null;
    const obj = rec.build();
    const id = safeId(obj.match.id) || crypto.randomBytes(8).toString('hex');
    obj.match.id = id;
    let json;
    try { json = JSON.stringify(obj); } catch (e) { return null; }
    const size = Buffer.byteLength(json);
    if (size > MAX_BYTES) return null;
    try { fs.writeFileSync(this._file(id), json); } catch (e) { return null; }
    const entry = {
      id, file: id + '.fhreplay', size, createdAt: Date.now(),
      map: obj.match.map, style: obj.match.style, mode: obj.match.mode, ranked: obj.match.ranked,
      end: obj.match.end, startedAt: obj.match.startedAt, endedAt: obj.match.endedAt,
      durationTicks: obj.durationTicks, durationSec: obj.durationSec,
      finalScore: obj.finalScore, teams: obj.teams,
      players: (obj.participants || []).slice(0, 22).map(p => ({ nick: String(p.nick || '').slice(0, 24), avatar: String(p.avatar || '').slice(0, 4), team: p.team === 2 ? 'blue' : 'red' })),
      userIds: Array.from(rec.userIds || [])
    };
    this.db.replays[id] = entry;
    this._enforceLimits(entry.userIds);
    this.save();
    return entry;
  }

  _enforceLimits(userIds) {
    const all = Object.values(this.db.replays);
    // por jogador
    for (const uid of userIds || []) {
      const mine = all.filter(r => (r.userIds || []).includes(uid)).sort((a, b) => a.createdAt - b.createdAt);
      while (mine.length > MAX_PER_USER) { const old = mine.shift(); this._delete(old.id); }
    }
    // global
    let total = Object.values(this.db.replays).sort((a, b) => a.createdAt - b.createdAt);
    while (total.length > MAX_TOTAL) { const old = total.shift(); this._delete(old.id); }
  }
  _delete(id) {
    const r = this.db.replays[id]; if (!r) return;
    try { fs.unlinkSync(path.join(this.dir, r.file)); } catch (e) {}
    delete this.db.replays[id];
  }

  /* indice (sem quadros) dos replays de um jogador, mais recentes primeiro */
  list(userId) {
    const uid = userId ? String(userId) : null;
    return Object.values(this.db.replays)
      .filter(r => uid && (r.userIds || []).includes(uid))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(r => ({ id: r.id, map: r.map, style: r.style, mode: r.mode, ranked: r.ranked, end: r.end,
        createdAt: r.createdAt, durationSec: r.durationSec, finalScore: r.finalScore, teams: r.teams, size: r.size }));
  }
  can(id, userId) {
    const r = this.db.replays[id];
    return !!(r && userId && (r.userIds || []).includes(String(userId)));
  }
  /* conteudo bruto do .fhreplay (Buffer) se o jogador participou */
  read(id, userId) {
    id = safeId(id); if (!id || !this.can(id, userId)) return null;
    try { return fs.readFileSync(this._file(id)); } catch (e) { return null; }
  }
  remove(id, userId) {
    id = safeId(id); if (!id || !this.can(id, userId)) return false;
    this._delete(id); this.save(); return true;
  }
}

module.exports = { Recorder, ReplayStore, validate, FORMAT_VERSION, MAGIC, TICK_RATE, SAMPLE_EVERY, MIN_TICKS, MAX_BYTES, MAX_FRAMES, MAX_PER_USER };
