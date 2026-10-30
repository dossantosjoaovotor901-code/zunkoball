'use strict';
const crypto = require('crypto');
const { db, save } = require('./db');

/* ===== Modos ranqueados (todos os modos do jogo) ===== */
const FUTSAL = { time: 5, score: 5 };
const REAL = { time: 6, score: 10 };
/* Catálogo único da ranqueada. requiredPlayers é o total humano da partida,
   não o tamanho de uma equipe. O pareamento e a sala usam exatamente este valor. */
const MODES = {
  v1: { label: 'Futsal 1v1', group: 'futsal', requiredPlayers: 2, teamSize: 1, rules: FUTSAL },
  v2: { label: 'Futsal 2v2', group: 'futsal', requiredPlayers: 4, teamSize: 2, rules: FUTSAL },
  v3: { label: 'Futsal 3v3', group: 'futsal', requiredPlayers: 6, teamSize: 3, rules: FUTSAL },
  v4: { label: 'Futsal 4v4', group: 'futsal', requiredPlayers: 8, teamSize: 4, rules: FUTSAL },
  r4: { label: 'Real 4v4', group: 'real', requiredPlayers: 8, teamSize: 4, rules: REAL },
  r5: { label: 'Real 5v5', group: 'real', requiredPlayers: 10, teamSize: 5, rules: REAL },
  r7: { label: 'Real 7v7', group: 'real', requiredPlayers: 14, teamSize: 7, rules: REAL },
  r9: { label: 'Real 9v9', group: 'real', requiredPlayers: 18, teamSize: 9, rules: REAL },
  r11: { label: 'Real 11v11', group: 'real', requiredPlayers: 22, teamSize: 11, rules: REAL }
};

/* ===== Pontuação Elo exclusivamente entre participantes humanos ===== */
const START = 800, AI_RATING = 1300, FLOOR = 0;
/* 18 patentes (ícones em game/ranks/rNN.png). Cada patente vale 100 pontos; a primeira cobre tudo abaixo de 900. */
const TIERS = [
  { id: 'r01', name: 'Recruta', min: 0 },
  { id: 'r02', name: 'Soldado', min: 900 },
  { id: 'r03', name: 'Cabo', min: 1000 },
  { id: 'r04', name: 'Sargento', min: 1100 },
  { id: 'r05', name: 'Subtenente', min: 1200 },
  { id: 'r06', name: 'Aspirante', min: 1300 },
  { id: 'r07', name: 'Tenente', min: 1400 },
  { id: 'r08', name: 'Capitão', min: 1500 },
  { id: 'r09', name: 'Major', min: 1600 },
  { id: 'r10', name: 'Tenente-Coronel', min: 1700 },
  { id: 'r11', name: 'Coronel', min: 1800 },
  { id: 'r12', name: 'Brigadeiro', min: 1900 },
  { id: 'r13', name: 'General', min: 2000 },
  { id: 'r14', name: 'Marechal', min: 2100 },
  { id: 'r15', name: 'Comandante', min: 2200 },
  { id: 'r16', name: 'Grão-Mestre', min: 2300 },
  { id: 'r17', name: 'Lenda', min: 2400 },
  { id: 'r18', name: 'Imortal', min: 2500 }
];
function tierOf(r) { let t = TIERS[0]; for (const x of TIERS) if (r >= x.min) t = x; return t; }

function statsFor(user, mode) {
  user.stats = user.stats || {};
  return user.stats[mode] || (user.stats[mode] = { rating: START, games: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, streak: 0, best: 0, peak: START });
}
function publicStats(user) {
  const out = {};
  for (const m of Object.keys(MODES)) {
    const s = user.stats && user.stats[m];
    const rating = s ? s.rating : START;
    const t = tierOf(rating);
    out[m] = { rating, games: s ? s.games : 0, wins: s ? s.wins : 0, draws: s ? s.draws : 0, losses: s ? s.losses : 0,
      streak: s ? s.streak : 0, peak: s ? s.peak : START, tier: t.id, tierName: t.name };
  }
  return out;
}

function applyResult(user, mode, red, blue, abandoned, oppRating) {
  const s = statsFor(user, mode);
  const diff = Math.abs(red - blue);
  let score = red > blue ? 1 : red < blue ? 0 : 0.5, gd = diff;
  if (abandoned) { score = 0; gd = 3; red = Math.min(red, 0); blue = Math.max(blue, 3); }
  const E = 1 / (1 + Math.pow(10, ((oppRating == null ? s.rating : oppRating) - s.rating) / 400));
  const K = s.games < 10 ? 48 : 32;
  const G = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;
  let delta = Math.round(K * G * (score - E));
  if (score === 1 && delta < 1) delta = 1;      // vitória sempre rende ao menos 1 ponto
  const before = s.rating;
  s.rating = Math.max(FLOOR, s.rating + delta);
  delta = s.rating - before;
  s.games++; s.gf += red; s.ga += blue;
  if (score === 1) { s.wins++; s.streak = Math.max(0, s.streak) + 1; }
  else if (score === 0) { s.losses++; s.streak = Math.min(0, s.streak) - 1; }
  else { s.draws++; s.streak = 0; }
  s.best = Math.max(s.best, s.streak);
  s.peak = Math.max(s.peak, s.rating);
  db.history.push({ u: user.id, m: mode, r: red, b: blue, d: delta, ab: !!abandoned, t: Date.now() });
  if (db.history.length > 3000) db.history.splice(0, db.history.length - 3000);
  invalidate(mode);
  return { delta, before, after: s.rating, result: score === 1 ? 'win' : score === 0 ? 'loss' : 'draw' };
}

/* ===== Partidas abertas (anti-abandono / anti-fraude básico) ===== */
function createMatch(user, mode, opp) {
  const info = MODES[mode];
  if (!info) return { error: 'Modo inválido.' };
  // partida anterior sem resultado = abandono (derrota)
  for (const id of Object.keys(db.openMatches)) {
    const m = db.openMatches[id];
    if (m.userId === user.id) { delete db.openMatches[id]; applyResult(user, m.mode, 0, 3, true, m.opp && m.opp.rating); }
  }
  const id = crypto.randomBytes(16).toString('hex');
  db.openMatches[id] = { userId: user.id, mode, startedAt: Date.now(), opp: opp || null };
  save();
  return { matchId: id, mode, opponent: opp || null, rules: { timeLimit: info.rules.time, scoreLimit: info.rules.score } };
}

function finishMatch(user, body) {
  const m = db.openMatches[body.matchId];
  if (!m || m.userId !== user.id) return { error: 'Partida ranqueada não encontrada (ou já finalizada).', status: 404 };
  // Partida contra HUMANO é online e o placar é calculado só pelo servidor (finishAuthoritative).
  // O navegador pode apenas abandonar (derrota própria); qualquer placar enviado é recusado e a partida continua aberta.
  if (m.opp && !m.opp.bot && body.abandon !== true) return { error: 'O resultado desta partida é definido pelo servidor.', status: 409 };
  delete db.openMatches[body.matchId];
  const rules = MODES[m.mode].rules;
  const elapsed = (Date.now() - m.startedAt) / 1000;

  if (body.abandon === true) {
    const r = applyResult(user, m.mode, 0, 3, true, m.opp && m.opp.rating); save();
    return { ok: true, abandoned: true, mode: m.mode, opponent: m.opp, ...r, stats: publicStats(user)[m.mode] };
  }
  const red = body.red, blue = body.blue;
  const okInt = n => Number.isInteger(n) && n >= 0 && n <= rules.score;
  const reachedLimit = okInt(red) && okInt(blue) && Math.max(red, blue) === rules.score;
  const timeUp = elapsed >= rules.time * 60 - 8;
  const minElapsed = 15 + 10 * ((red | 0) + (blue | 0));
  if (!okInt(red) || !okInt(blue) || !(reachedLimit || timeUp) || elapsed < minElapsed || elapsed > rules.time * 60 + 20 * 60) {
    save();
    return { error: 'Resultado inválido: a partida não foi contabilizada.', status: 422 };
  }
  const r = applyResult(user, m.mode, red, blue, false, m.opp && m.opp.rating); save();
  return { ok: true, mode: m.mode, red, blue, opponent: m.opp, ...r, stats: publicStats(user)[m.mode] };
}

/* Fechamento AUTORITATIVO: quem calcula o placar é o servidor de partidas (server/room.js), não o navegador.
   Por isso não há checagem de plausibilidade de tempo/placar aqui: o resultado já nasceu de uma simulação validada.
   own/opp = gols do jogador / do adversário. */
function finishAuthoritative(user, matchId, own, opp, abandoned) {
  const m = db.openMatches[matchId];
  if (!m || m.userId !== user.id) return null;
  delete db.openMatches[matchId];
  const r = applyResult(user, m.mode, own, opp, !!abandoned, m.opp && m.opp.rating); save();
  return { ok: true, abandoned: !!abandoned, mode: m.mode, red: own, blue: opp, opponent: m.opp, ...r, stats: publicStats(user)[m.mode] };
}
function voidMatch(user, matchId) {      // partida anulada (adversário nunca apareceu): sem pontos para ninguém
  const m = db.openMatches[matchId];
  if (m && m.userId === user.id) { delete db.openMatches[matchId]; save(); return true; }
  return false;
}

// partidas abertas que nunca foram finalizadas (aba fechada) viram derrota ao expirar
function sweepOpen() {
  const now = Date.now(); let n = 0;
  for (const id of Object.keys(db.openMatches)) {
    const m = db.openMatches[id], limit = (MODES[m.mode].rules.time + 25) * 60e3;
    if (now - m.startedAt > limit) {
      const u = db.users[m.userId];
      delete db.openMatches[id];
      if (u) applyResult(u, m.mode, 0, 3, true, m.opp && m.opp.rating);
      n++;
    }
  }
  if (n) save();
}
setInterval(sweepOpen, 60e3).unref();

/* ===== Ranking ===== */
const cache = {};
function invalidate(mode) { delete cache[mode]; }
function board(mode) {
  const c = cache[mode];
  if (c && Date.now() - c.t < 5000) return c.list;
  const list = [];
  for (const u of Object.values(db.users)) {
    const s = u.stats && u.stats[mode];
    if (s && s.games > 0) list.push({ id: u.id, username: u.username, nick: u.nick, avatar: u.avatar, rating: s.rating, wins: s.wins, games: s.games });
  }
  list.sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.username.localeCompare(b.username));
  list.forEach((e, i) => { e.pos = i + 1; });
  cache[mode] = { t: Date.now(), list };
  return list;
}
function ranking(mode, me, limit) {
  if (!MODES[mode]) return { error: 'Modo inválido.' };
  const list = board(mode);
  const top = list.slice(0, limit).map(e => ({ pos: e.pos, nick: e.nick, avatar: e.avatar, username: e.username, rating: e.rating,
    wins: e.wins, games: e.games, tier: tierOf(e.rating).id, tierName: tierOf(e.rating).name, me: !!me && e.id === me.id }));
  let mine = null;
  if (me) {
    const e = list.find(x => x.id === me.id);
    const s = publicStats(me)[mode];
    mine = { pos: e ? e.pos : null, ...s };
  }
  return { mode, label: MODES[mode].label, total: list.length, top, me: mine };
}

module.exports = { MODES, TIERS, START, AI_RATING, tierOf, publicStats, createMatch, finishMatch, finishAuthoritative, voidMatch, ranking };
