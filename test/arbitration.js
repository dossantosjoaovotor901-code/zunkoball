'use strict';
const assert = require('assert');
const Sim = require('../game/sim');
const { MAPS } = require('../server/room');
let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; console.log('PASS ' + msg); }
function world(opts) { return Sim.create(MAPS.MAPS.v1, Object.assign({ style: 'futsal', scoreLimit: 5, timeLimit: 300, arbitration: true, overtime: 2, goldenGoal: true }, opts)); }

// A contagem autoritativa impede o time sem a posse de cruzar o meio.
{
  const w = world();
  const slot = Sim.addPlayer(w, 1, 1);
  w.s.phase = Sim.PH.COUNTDOWN; w.s.cd = 2; w.s.barrierTeam = 1;
  w.s.players[slot].x = w.cfg.cx + 4;
  Sim.step(w, []);
  ok(w.s.players[slot].x <= w.cfg.cx - w.s.players[slot].r, 'barreira impede o RED de atravessar o meio durante reinício');
}

// Gol no lado direito vale para RED e entrega a posse inicial ao BLUE.
{
  const w = world();
  w.s.phase = Sim.PH.PLAY; w.s.timeTicks = 1000;
  w.s.ball.x = w.cfg.right[0].x1 + 2; w.s.ball.y = w.cfg.cy;
  Sim.step(w, []);
  ok(w.s.red === 1 && w.s.blue === 0, 'gol é decidido pelo servidor com o lado correto');
  ok(w.s.restartTeam === 2 && w.s.barrierTeam === 2, 'time que sofreu o gol recebe a posse e a barreira é simétrica');
}

// Empate no fim do tempo entra na prorrogação configurada; empate persistente encerra sem vencedor.
{
  const w = world({ overtime: 2, goldenGoal: false });
  w.s.phase = Sim.PH.PLAY; w.s.timeTicks = 1; w.s.red = 2; w.s.blue = 2;
  Sim.step(w, []);
  ok(w.s.overtime && w.s.timeTicks === 120, 'empate inicia prorrogação de 2 minutos');
  w.s.timeTicks = 1; Sim.step(w, []);
  ok(w.s.phase === Sim.PH.ENDED && w.s.red === w.s.blue, 'empate persistente termina como empate');
}

// Durante a prorrogação, gol de ouro encerra imediatamente.
{
  const w = world({ overtime: 2, goldenGoal: true });
  w.s.phase = Sim.PH.PLAY; w.s.overtime = true; w.s.timeTicks = 1000;
  w.s.ball.x = w.cfg.right[0].x1 + 2; w.s.ball.y = w.cfg.cy;
  Sim.step(w, []);
  ok(w.s.phase === Sim.PH.ENDED && w.s.red === 1, 'gol de ouro encerra a prorrogação');
}
console.log('TODOS OS ' + pass + ' TESTES DE ARBITRAGEM PASSARAM');
