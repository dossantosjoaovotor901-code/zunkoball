/* Estatisticas de replay do FutHub.
 * Calcula tudo a partir dos DADOS REAIS gravados no .fhreplay (quadros + eventos + elenco).
 * Quando uma estatistica nao pode ser derivada dos dados, devolve null + motivo (available.*),
 * para a UI mostrar "nao disponivel" em vez de inventar numeros.
 * UMD: window.FH_STATS no navegador, module.exports no Node (testes). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FH_STATS = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var EV = { KICK: 1, POST: 2, NET: 3, GOAL: 4, WHISTLE: 5, RESTART: 6, END: 7 };
  var ASSIST_WINDOW_SEC = 8;

  function teamStr(t) { return (t === 2 || t === 'blue') ? 'blue' : 'red'; }
  function clamp0(v) { return v < 0 ? 0 : v; }

  // elenco por slot no instante tick (usa o log de roster do replay)
  function rosterAt(obj, tick) {
    var log = obj.roster || [], best = log.length ? log[0].slots : {};
    for (var i = 0; i < log.length; i++) { if (log[i].tick <= tick) best = log[i].slots; else break; }
    return best || {};
  }
  function slotTeam(obj, slot, tick) { var r = rosterAt(obj, tick)[slot]; return r ? (r.team | 0) : 0; }
  // nome "definitivo" de um slot: ultimo roster que o conhece, senao participants
  function buildNames(obj) {
    var names = {}, log = obj.roster || [];
    for (var i = 0; i < log.length; i++) { var s = log[i].slots || {}; for (var k in s) if (s.hasOwnProperty(k)) names[k] = { nick: s[k].nick || '', team: s[k].team | 0, avatar: s[k].av || '' }; }
    (obj.participants || []).forEach(function (p) { if (names[p.slot] == null) names[p.slot] = { nick: p.nick || '', team: p.team | 0, avatar: p.avatar || '' }; });
    return names;
  }

  function compute(obj) {
    var frames = (obj && obj.frames) || [];
    var events = (obj && obj.events) || [];
    var tickRate = (obj && obj.tickRate) || 60;
    var t0 = frames.length ? frames[0].t : 0, t1 = frames.length ? frames[frames.length - 1].t : 0;
    var elapsed = function (tick) { return clamp0(Math.round((tick - t0) / tickRate)); };
    var names = buildNames(obj);

    var kicks = events.filter(function (e) { return e[0] === EV.KICK && (e[2] | 0) >= 0; })
      .map(function (e) { return { tick: e[1] | 0, slot: e[2] | 0 }; }).sort(function (a, b) { return a.tick - b.tick; });
    var hasKicks = kicks.length > 0;

    // ---- gols (reais, dos eventos) ----
    var goalEvents = events.filter(function (e) { return e[0] === EV.GOAL; }).sort(function (a, b) { return a[1] - b[1]; });
    var anyScorer = goalEvents.some(function (e) { return (e[5] | 0) >= 0; });
    var goals = goalEvents.map(function (e) {
      var tick = e[1] | 0, scored = e[2] | 0, scorer = e[5] | 0;
      var g = { tick: tick, elapsedSec: elapsed(tick), team: teamStr(scored), redScore: e[3] | 0, blueScore: e[4] | 0,
        scorerSlot: scorer >= 0 ? scorer : null, scorerName: scorer >= 0 && names[scorer] ? names[scorer].nick : null,
        assistSlot: null, assistName: null };
      // assistencia estimada: ultimo passe/chute de um companheiro, nos ultimos ASSIST_WINDOW_SEC s
      if (hasKicks && scorer >= 0) {
        var lo = tick - ASSIST_WINDOW_SEC * tickRate, best = null;
        for (var i = 0; i < kicks.length; i++) {
          var k = kicks[i]; if (k.tick > tick) break; if (k.tick < lo) continue;
          if (k.slot !== scorer && slotTeam(obj, k.slot, k.tick) === scored) best = k;
        }
        if (best) { g.assistSlot = best.slot; g.assistName = names[best.slot] ? names[best.slot].nick : null; }
      }
      return g;
    });

    // ---- posse de bola (por segmentos entre toques) ----
    var possession = null, possBySlot = {};
    if (hasKicks) {
      var secRed = 0, secBlue = 0;
      for (var i = 0; i < kicks.length; i++) {
        var from = kicks[i].tick, to = (i + 1 < kicks.length ? kicks[i + 1].tick : t1);
        var dur = clamp0(to - from) / tickRate, tm = slotTeam(obj, kicks[i].slot, from);
        if (tm === 2) secBlue += dur; else if (tm === 1) secRed += dur;
        possBySlot[kicks[i].slot] = (possBySlot[kicks[i].slot] || 0) + dur;
      }
      var tot = secRed + secBlue;
      possession = { red: Math.round(secRed), blue: Math.round(secBlue),
        redPct: tot > 0 ? Math.round(secRed / tot * 100) : 0, bluePct: tot > 0 ? Math.round(secBlue / tot * 100) : 0 };
    }
    // ---- toques na bola por slot (reais, dos eventos KICK) ----
    var touches = {};
    if (hasKicks) kicks.forEach(function (k) { touches[k.slot] = (touches[k.slot] || 0) + 1; });

    // ---- tempo jogado por slot (do log de roster) ----
    var playedTicks = {}, log = obj.roster || [];
    for (var r = 0; r < log.length; r++) {
      var segEnd = (r + 1 < log.length ? log[r + 1].tick : t1), segDur = clamp0(segEnd - log[r].tick);
      var s = log[r].slots || {};
      for (var sk in s) if (s.hasOwnProperty(sk)) playedTicks[sk] = (playedTicks[sk] || 0) + segDur;
    }

    // ---- gols por slot ----
    var goalsBySlot = {};
    if (anyScorer) goals.forEach(function (g) { if (g.scorerSlot != null) goalsBySlot[g.scorerSlot] = (goalsBySlot[g.scorerSlot] || 0) + 1; });
    var assistsBySlot = {};
    goals.forEach(function (g) { if (g.assistSlot != null) assistsBySlot[g.assistSlot] = (assistsBySlot[g.assistSlot] || 0) + 1; });

    // ---- lista de jogadores ----
    var players = Object.keys(names).map(function (slotKey) {
      var slot = slotKey | 0, info = names[slotKey];
      return {
        slot: slot, nick: info.nick, team: teamStr(info.team), avatar: info.avatar,
        goals: anyScorer ? (goalsBySlot[slot] || 0) : null,
        assists: hasKicks ? (assistsBySlot[slot] || 0) : null,
        touches: hasKicks ? (touches[slot] || 0) : null,
        playedSec: Math.round((playedTicks[slot] || 0) / tickRate),
        possessionSec: hasKicks ? Math.round(possBySlot[slot] || 0) : null
      };
    }).sort(function (a, b) { return (b.goals || 0) - (a.goals || 0) || (b.touches || 0) - (a.touches || 0) || a.slot - b.slot; });

    // ---- linha do tempo + melhores momentos ----
    var timeline = [];
    events.forEach(function (e) {
      var tick = e[1] | 0, type = e[0];
      if (type === EV.GOAL) { var sc = (e[5] | 0) >= 0 && names[e[5]] ? names[e[5]].nick : null; timeline.push({ tick: tick, elapsedSec: elapsed(tick), type: 'goal', team: teamStr(e[2] | 0), label: 'GOL' + (sc ? ' - ' + sc : '') }); }
      else if (type === EV.POST) timeline.push({ tick: tick, elapsedSec: elapsed(tick), type: 'post', team: null, label: 'Na trave' });
      else if (type === EV.WHISTLE) timeline.push({ tick: tick, elapsedSec: elapsed(tick), type: 'whistle', team: null, label: 'Apito' });
    });
    timeline.sort(function (a, b) { return a.tick - b.tick; });
    var bestMoments = timeline.filter(function (x) { return x.type === 'goal' || x.type === 'post'; })
      .map(function (x) { return { tick: x.tick, elapsedSec: x.elapsedSec, team: x.team, kind: x.type, label: x.type === 'goal' ? 'Gol' + (x.label.indexOf(' - ') >= 0 ? x.label.slice(x.label.indexOf(' - ')) : '') : 'Quase gol (trave)' }; });

    var teams = { red: [], blue: [] };
    players.forEach(function (p) { if (p.nick) (p.team === 'blue' ? teams.blue : teams.red).push(p.nick); });

    return {
      tickRate: tickRate, firstTick: t0, lastTick: t1, durationSec: elapsed(t1),
      finalScore: (obj.finalScore ? { red: obj.finalScore.red | 0, blue: obj.finalScore.blue | 0 }
        : { red: frames.length ? frames[frames.length - 1].r | 0 : 0, blue: frames.length ? frames[frames.length - 1].bl | 0 : 0 }),
      teams: teams, players: players, goals: goals, possession: possession,
      shots: null, // o gravador nao distingue finalizacao de toque -> indisponivel
      timeline: timeline, bestMoments: bestMoments,
      available: {
        goalsPerPlayer: anyScorer, assists: hasKicks && anyScorer, touches: hasKicks,
        possession: hasKicks, shots: false, playedTime: (log.length > 0),
        shotsReason: 'O gravador registra toques (KICK), nao finalizacoes a gol.',
        possessionReason: hasKicks ? '' : 'Sem eventos de toque gravados neste replay (ex.: partida offline).'
      }
    };
  }

  return { compute: compute, EV: EV, rosterAt: rosterAt, buildNames: buildNames };
}));
