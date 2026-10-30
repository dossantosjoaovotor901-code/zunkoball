'use strict';
/* Testes do sistema de replay (sem rede real — roda em Node puro). Rodar: node test/replay.js
 * Cobre: Recorder (amostragem + build), validate(), ReplayStore (disco, indice, limites)
 * e a integracao com a Room (grava a partida a partir do estado autoritativo). */

// limites reduzidos para o teste ser rapido e exercitar o corte por jogador
process.env.FUTHUB_REPLAY_MIN_TICKS = process.env.FUTHUB_REPLAY_MIN_TICKS || '60';
process.env.FUTHUB_REPLAY_MAX_PER_USER = process.env.FUTHUB_REPLAY_MAX_PER_USER || '2';

const fs = require('fs'), os = require('os'), path = require('path');
const Sim = require('../game/sim.js');
const { Room, MAPS } = require('../server/room.js');
const Replay = require('../server/replay.js');
const { Recorder, ReplayStore, validate } = Replay;

let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('FAIL ' + m); } else console.log('PASS ' + m); };
const fakeConn = () => ({ out: [], buffered: 0, closed: false, send(d) { this.out.push(d); }, close() { this.closed = true; } });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-replay-'));

/* feed: roda a simulacao e amostra como o servidor faria */
function recordMatch(ticks, users) {
  const w = Sim.create(MAPS.MAPS.v1, {});
  Sim.addPlayer(w, 1); Sim.addPlayer(w, 2);
  const rec = new Recorder({ map: 'v1', style: 'futsal', mode: 'online', id: null });
  (users || []).forEach(u => rec.addUser(u));
  rec.roster([{ slot: 0, nick: 'Vermelho', av: 'P1', team: 1 }, { slot: 1, nick: 'Azul', av: 'P2', team: 2 }], 0);
  rec.sample(w.s, true);
  for (let i = 0; i < ticks; i++) {
    Sim.step(w, [{ x: (i % 80) < 40 ? 120 : -120, y: ((i >> 3) % 2) ? 60 : -60, kick: i % 37 === 0 }, { x: -80, y: 10 }]);
    if (w.events.length) { for (const e of w.events) rec.event([e.type, e.tick, e.a, e.b, e.c, e.d]); w.events.length = 0; }
    rec.sample(w.s);
  }
  rec.sample(w.s, true);
  rec.finalize('normal');
  return rec;
}

// 1. Recorder produz um replay valido com quadros e elenco
{
  const rec = recordMatch(240, ['uA']);
  ok(rec.hasEnough(), 'Recorder: partida com duracao suficiente e aceita');
  const obj = rec.build();
  ok(validate(obj).ok, 'Recorder: objeto gerado passa na validacao');
  ok(obj.frames.length >= 2 && obj.frames[0].t < obj.frames[obj.frames.length - 1].t, 'Recorder: quadros em ordem crescente de tick');
  ok(obj.participants.length === 2 && obj.teams.red.length === 1 && obj.teams.blue.length === 1, 'Recorder: elenco (2 jogadores, 1 por time) no replay');
  ok(obj.magic === 'FHREPLAY' && obj.formatVersion === 1 && obj.kind === 'online', 'Recorder: cabecalho .fhreplay correto (magic/versao/kind)');
  const f = obj.frames[1];
  ok(Array.isArray(f.b) && f.b.length === 4 && Array.isArray(f.p), 'Recorder: quadro tem bola [x,y,vx,vy] e lista de jogadores');
}

// 2. partidas curtas demais sao descartadas
{
  const rec = recordMatch(10, ['uA']);
  ok(!rec.hasEnough(), 'Recorder: partida curta (< minimo) e descartada');
}

// 3. validate() rejeita arquivos invalidos
{
  ok(!validate(null).ok, 'validate: nulo rejeitado');
  ok(!validate({ magic: 'X', formatVersion: 1, frames: [{}], events: [], match: {} }).ok, 'validate: magic errado rejeitado');
  ok(!validate({ magic: 'FHREPLAY', formatVersion: 99, frames: [{ b: [], p: [] }], events: [], match: {} }).ok, 'validate: versao incompativel rejeitada');
  ok(!validate({ magic: 'FHREPLAY', formatVersion: 1, frames: [], events: [], match: {} }).ok, 'validate: sem quadros rejeitado');
}

// 4. ReplayStore: grava em disco, lista por participante, le, protege e apaga
{
  const store = new ReplayStore({ dir: tmp, db: {}, save: () => {} });
  const entry = store.put(recordMatch(240, ['uA', 'uB']));
  ok(entry && entry.id && fs.existsSync(path.join(tmp, entry.file)), 'ReplayStore: grava o .fhreplay em disco');
  ok(Array.isArray(entry.players) && entry.players.length >= 1 && entry.players.every(p => (p.team === 'red' || p.team === 'blue') && typeof p.nick === 'string' && typeof p.avatar === 'string'), 'ReplayStore: indice guarda jogadores (nick/avatar/time) para a lista mostrar os bonecos');
  ok(store.list('uA').length === 1 && store.list('uB').length === 1, 'ReplayStore: lista aparece para os participantes');
  ok(store.list('outro').length === 0, 'ReplayStore: quem nao jogou nao ve o replay');
  const buf = store.read(entry.id, 'uA');
  ok(buf && validate(JSON.parse(buf.toString())).ok, 'ReplayStore: participante baixa e o arquivo e valido');
  ok(store.read(entry.id, 'outro') === null, 'ReplayStore: nao-participante nao consegue baixar');
  ok(store.remove(entry.id, 'outro') === false, 'ReplayStore: nao-participante nao consegue apagar');
  ok(store.remove(entry.id, 'uA') === true && !fs.existsSync(path.join(tmp, entry.file)), 'ReplayStore: participante apaga e o arquivo some');
}

// 5. ReplayStore: limite por jogador (mantem apenas os mais recentes)
{
  const store = new ReplayStore({ dir: tmp, db: {}, save: () => {} });
  for (let i = 0; i < 4; i++) store.put(recordMatch(120, ['lim']));
  ok(store.list('lim').length <= 2, 'ReplayStore: respeita o teto de replays por jogador (<= 2)');
}

// 6. integracao com a Room: grava a partida a partir do estado autoritativo
{
  let saved = null;
  const room = new Room({ id: 'r', name: 'Sala', mapKey: 'v1', max: 4 }, { saveReplay: rec => { saved = rec; return { id: 'x' }; } });
  const a = room.join(fakeConn(), { nick: 'A', user: { id: 'uA' } });
  const b = room.join(fakeConn(), { nick: 'B', user: { id: 'uB' } });
  ok(a.client && b.client && a.client.slot >= 0 && b.client.slot >= 0, 'Room: dois jogadores sentados em times');
  room.start();
  for (let i = 0; i < 150; i++) room.tick();
  room.stop();
  ok(saved && saved.hasEnough(), 'Room: a partida foi gravada ao parar');
  const obj = saved.build();
  ok(validate(obj).ok, 'Room: o replay gravado e valido');
  ok(saved.userIds.has('uA') && saved.userIds.has('uB'), 'Room: participantes registrados no replay');
  ok(obj.match.mode === 'online' && obj.frames.length >= 2, 'Room: replay marcado como online com quadros');
}

// 7. estatisticas (game/replaystats.js): derivadas dos dados reais, sem inventar
{
  const FH_STATS = require('../game/replaystats.js');
  const obj = recordMatch(600, ['uA', 'uB']).build();
  const s = FH_STATS.compute(obj);
  ok(s && s.finalScore && typeof s.finalScore.red === 'number', 'Stats: placar final presente');
  ok(s.durationSec > 0, 'Stats: duracao calculada em segundos');
  ok(Array.isArray(s.players) && s.players.length >= 2, 'Stats: lista de jogadores a partir do elenco');
  ok(s.players.every(p => p.playedSec >= 0), 'Stats: tempo jogado calculado para cada jogador');
  const hasKick = obj.events.some(e => e[0] === 1);
  if (hasKick) {
    ok(s.available.possession && s.possession, 'Stats: posse disponivel quando ha toques (KICK)');
    ok(s.possession.redPct + s.possession.bluePct === 100 || (s.possession.red + s.possession.blue) === 0, 'Stats: posse soma 100%');
    ok(s.available.touches && s.players.some(p => p.touches > 0), 'Stats: toques por jogador contabilizados');
  }
  ok(s.shots === null && s.available.shots === false, 'Stats: finalizacoes marcadas como indisponiveis (nao inventa)');
  ok(Array.isArray(s.timeline) && Array.isArray(s.bestMoments), 'Stats: linha do tempo e melhores momentos sao listas');
  ok(Array.isArray(s.goals), 'Stats: gols extraidos dos eventos');

  // cenario online sintetico com toques (KICK) + gol com autor e assistencia
  const onl = {
    tickRate: 60,
    match: { map: 'v1', mode: 'online' },
    finalScore: { red: 1, blue: 0 },
    roster: [{ tick: 0, slots: { 0: { nick: 'A', av: 'P1', team: 1 }, 1: { nick: 'B', av: 'P2', team: 1 }, 2: { nick: 'C', av: 'P3', team: 2 } } }],
    participants: [{ slot: 0, nick: 'A', team: 1 }, { slot: 1, nick: 'B', team: 1 }, { slot: 2, nick: 'C', team: 2 }],
    frames: [{ t: 0, b: [0, 0, 0, 0], p: [[0, 1, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0], [2, 2, 0, 0, 0, 0]] }, { t: 600, b: [0, 0, 0, 0], p: [[0, 1, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0], [2, 2, 0, 0, 0, 0]] }],
    events: [[1, 60, 2, 0, 0, 0], [1, 180, 1, 0, 0, 0], [1, 210, 0, 0, 0, 0], [4, 240, 1, 1, 0, 0]]
  };
  const sn = FH_STATS.compute(onl);
  ok(sn.available.possession && sn.possession && (sn.possession.redPct + sn.possession.bluePct) === 100, 'Stats(online): posse disponivel e soma 100%');
  ok(sn.available.touches && sn.players.find(p => p.slot === 0).touches === 1, 'Stats(online): toques por jogador contabilizados');
  ok(sn.available.goalsPerPlayer && sn.players.find(p => p.slot === 0).goals === 1, 'Stats(online): gol atribuido ao autor (slot 0)');
  ok(sn.goals[0].scorerName === 'A' && sn.goals[0].assistName === 'B', 'Stats(online): autor e assistencia estimada corretos');

  // cenario offline: sem eventos KICK e sem autor de gol -> indica indisponivel, nao inventa
  const off = {
    tickRate: 60,
    match: { map: 'v1', mode: 'offline' },
    finalScore: { red: 2, blue: 1 },
    roster: [{ tick: 0, slots: { 0: { nick: 'Eu', av: 'P1', team: 1 }, 1: { nick: 'CPU', av: 'P2', team: 2 } } }],
    participants: [{ slot: 0, nick: 'Eu', team: 1 }, { slot: 1, nick: 'CPU', team: 2 }],
    frames: [{ t: 0, b: [0, 0, 0, 0], p: [[0, 1, 0, 0, 0, 0], [1, 2, 0, 0, 0, 0]] }, { t: 600, b: [0, 0, 0, 0], p: [[0, 1, 0, 0, 0, 0], [1, 2, 0, 0, 0, 0]] }],
    events: [[4, 120, 1, 1, 0, -1], [4, 300, 2, 1, 1, -1], [4, 480, 1, 2, 1, -1]]
  };
  const so = FH_STATS.compute(off);
  ok(so.goals.length === 3, 'Stats(offline): 3 gols extraidos dos eventos');
  ok(so.available.possession === false && so.possession === null, 'Stats(offline): posse indisponivel sem toques');
  ok(so.available.goalsPerPlayer === false && so.players.every(p => p.goals === null), 'Stats(offline): gols por jogador indisponiveis (autor desconhecido)');
  ok(so.players.every(p => p.playedSec > 0), 'Stats(offline): tempo jogado ainda disponivel pelo roster');
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) {}
console.log(fail ? ('FALHOU ' + fail + '/' + n) : ('TODOS OS ' + n + ' TESTES DE REPLAY PASSARAM'));
process.exit(fail ? 1 : 0);
