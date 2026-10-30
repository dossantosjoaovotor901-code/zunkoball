'use strict';
/* Fila de pareamento por modo e patente.
   - Cada jogador entra na fila de UM modo. A busca começa só na própria patente.
   - Com o tempo a janela de patentes se abre: primeiro PARA CIMA (pode pegar patente mais alta),
     e para baixo só bem mais devagar (metade da velocidade).
   - A velocidade depende da população do modo: modo com poucos jogadores abre a janela rápido,
     modo cheio espera mais tempo por alguém da mesma patente.
   - Dois jogadores só são pareados se cada um está dentro da janela do outro.
   - A ranqueada é exclusivamente humana: nunca cria adversário de reserva.
   - Um grupo só é fechado quando há a quantidade humana exigida pelo modo. */
const { db } = require('./db');
const rk = require('./ranking');

const tickets = new Map();
const hooks = { createRankedRoom: null };   // preenchido pelo server.js (servidor de partidas)
let pairSeq = 0;          // userId -> ticket
const MATCH_HOLD_MS = 40e3;         // tempo para aceitar após achar adversário
const STALE_MS = 15e3;              // sem "status" por esse tempo = saiu da fila

const tierIdx = r => { let i = 0; rk.TIERS.forEach((t, k) => { if (r >= t.min) i = k; }); return i; };

const popCache = {};
function population(mode) {
  const c = popCache[mode];
  if (c && Date.now() - c.t < 10e3) return c.n;
  let n = 0;
  for (const u of Object.values(db.users)) { const s = u.stats && u.stats[mode]; if (s && s.games > 0) n++; }
  popCache[mode] = { t: Date.now(), n };
  return n;
}
function queueSize(mode) { let n = 0; for (const t of tickets.values()) if (t.mode === mode && !t.matched) n++; return n; }

// segundos para abrir "mais uma patente" na janela de busca
function stepSeconds(pop) { return pop >= 200 ? 15 : pop >= 50 ? 10 : pop >= 15 ? 7 : 4; }
function windowFor(t, waitSec, pop) {
  const step = stepSeconds(pop);
  const up = Math.floor(waitSec / step), down = Math.floor(waitSec / (2 * step));
  const max = rk.TIERS.length - 1;
  return { lo: Math.max(0, t.tier - down), hi: Math.min(max, t.tier + up) };
}

function oppOf(user, mode) {
  const s = rk.publicStats(user)[mode];
  return { nick: user.nick, avatar: user.avatar, rating: s.rating, tier: s.tier, tierName: s.tierName, bot: false, userId: user.id };
}
const publicOpp = o => ({ nick: o.nick, avatar: o.avatar, rating: o.rating, tier: o.tier, tierName: o.tierName, bot: !!o.bot });

function tick() {
  const now = Date.now();
  for (const [uid, t] of tickets) {
    if (!t.matched && now - t.lastSeen > STALE_MS) tickets.delete(uid);
    else if (t.matched && now - t.matched.at > MATCH_HOLD_MS) tickets.delete(uid);
  }
  for (const mode of Object.keys(rk.MODES)) {
    const need = rk.MODES[mode].requiredPlayers;
    const list = [...tickets.values()].filter(t => t.mode === mode && !t.matched).sort((a, b) => a.joinedAt - b.joinedAt);
    if (list.length < need) continue;
    const pop = population(mode) + list.length;
    const used = new Set();
    for (const A of list) {
      if (used.has(A)) continue;
      const wA = (now - A.joinedAt) / 1000, winA = windowFor(A, wA, pop);
      const group = [A];
      for (const B of list) {
        if (B === A || used.has(B) || group.length >= need) continue;
        const winB = windowFor(B, (now - B.joinedAt) / 1000, pop);
        if (B.tier >= winA.lo && B.tier <= winA.hi && A.tier >= winB.lo && A.tier <= winB.hi) {
          group.push(B);
        }
      }
      if (group.length < need) continue;
      const humans = group.map(t => db.users[t.userId]).filter(Boolean);
      if (humans.length !== need) continue;
      const users = {};
      group.forEach((t, i) => { users[t.userId] = i < need / 2 ? 1 : 2; });
      const pair = { id: ++pairSeq, mode, requiredPlayers: need, users, matches: {}, room: null };
      group.forEach(t => {
        const opponent = humans.find(u => users[u.id] !== users[t.userId]);
        t.matched = { at: now, opp: oppOf(opponent, mode), pair };
        used.add(t);
      });
    }
  }
}
setInterval(tick, 1000).unref();

function join(user, mode) {
  if (!rk.MODES[mode]) return { error: 'Modo inválido.' };
  const s = rk.publicStats(user)[mode];
  const now = Date.now();
  tickets.set(user.id, { userId: user.id, mode, joinedAt: now, lastSeen: now, rating: s.rating, tier: tierIdx(s.rating), matched: null });
  return { ok: true, mode };
}
function leave(user) { tickets.delete(user.id); return { ok: true }; }

function status(user) {
  const t = tickets.get(user.id);
  if (!t) return { state: 'idle' };
  t.lastSeen = Date.now();
  const rules = rk.MODES[t.mode].rules;
  if (t.matched) return { state: 'matched', mode: t.mode, opponent: publicOpp(t.matched.opp), online: !!t.matched.pair, rules: { timeLimit: rules.time, scoreLimit: rules.score } };
  const wait = (Date.now() - t.joinedAt) / 1000, pop = population(t.mode) + queueSize(t.mode);
  const w = windowFor(t, wait, pop);
  return { state: 'searching', mode: t.mode, elapsed: Math.floor(wait),
    me: { tier: rk.TIERS[t.tier].id, tierIdx: t.tier, rating: t.rating },
    window: { lo: w.lo, hi: w.hi }, queue: queueSize(t.mode), population: pop,
    botIn: 0 };
}

// confirma a partida: só agora ela é aberta no servidor (cancelar antes não gera derrota)
function accept(user) {
  const t = tickets.get(user.id);
  if (!t || !t.matched) return { error: 'Nenhum adversário encontrado.', status: 404 };
  tickets.delete(user.id);
  const pair = t.matched.pair;
  // aceite tardio: a sala deste pareamento já foi encerrada/anulada -> não abre partida (evita derrota pendente indevida)
  if (pair && pair.room && (pair.room.result || pair.room.closing)) return { error: 'Partida cancelada: o adversário não apareceu a tempo. Sem pontos.', status: 409 };
  const res = rk.createMatch(user, t.mode, t.matched.opp);
  if (res.error || !pair || !hooks.createRankedRoom) return res;
  pair.matches[user.id] = res.matchId;
  if (!pair.room) {
    const made = hooks.createRankedRoom(pair);
    if (made.error) { rk.voidMatch(user, res.matchId); delete pair.matches[user.id]; return { error: made.error, status: 503 }; }
    pair.room = made.room;
  }
  return Object.assign(res, { online: { room: pair.room.id, team: pair.users[user.id] } });
}

module.exports = { join, leave, status, accept, tick, hooks, _tickets: tickets };
