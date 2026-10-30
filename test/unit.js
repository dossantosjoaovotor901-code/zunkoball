'use strict';
/* Testes unitários/robustez do multiplayer (sem rede real). Rodar: node test/unit.js */
const Sim = require('../game/sim.js'), Proto = require('../game/proto.js');
const { EventEmitter } = require('events');
const { Client } = require('../game/netclient.js');
const { Room, MAPS } = require('../server/room.js');
const { WSConn } = require('../server/ws.js');
const { NetSim } = require('./netsim.js');
let fail = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fail++; console.log('FAIL ' + m); } else console.log('PASS ' + m); };
const fakeConn = () => ({ out: [], buffered: 0, closed: false, send(d) { this.out.push(d); }, close() { this.closed = true; } });
const msgs = c => c.out.filter(x => typeof x === 'string').map(x => JSON.parse(x));
const mkRoom = (o) => new Room(Object.assign({ id: 'u', name: 'u', mapKey: 'v1', max: 4 }, o || {}), {});
const inp = (seq, x, y, kick) => Proto.encodeInputs([{ seq, x, y, kick: kick ? 1 : 0, pass: 0 }]);

// 1. física determinística e independente de quadros
{
  const run = () => { const w = Sim.create(MAPS.MAPS.v1, {}); Sim.addPlayer(w, 1); Sim.addPlayer(w, 2);
    for (let i = 0; i < 1500; i++) Sim.step(w, [{ x: 100, y: (i % 90) - 45, kick: i % 37 === 0 }, { x: -90, y: 20, kick: i % 53 === 0 }]); return JSON.stringify(Sim.cloneState(w.s)); };
  ok(run() === run(), 'simulação determinística (mesmas entradas = mesmo estado, bit a bit)');
}
// 2a. FPS não altera a física: acumulador de passo fixo com quadros de 20 a 240 FPS => mesmo estado
{
  const hashes = new Set();
  for (const fps of [20, 30, 60, 75, 144, 240]) {
    const w = Sim.create(MAPS.MAPS.v1, {}); Sim.addPlayer(w, 1); Sim.addPlayer(w, 2);
    let acc = 0, tick = 0; const dt = 1000 / fps;
    while (tick < 1800) { acc += dt / 1000; while (acc >= Sim.TICK_DT - 1e-12 && tick < 1800) { Sim.step(w, [{ x: (tick % 120) < 60 ? 127 : -127, y: ((tick >> 3) % 2) ? 60 : -60, kick: tick % 41 === 0 }, { x: -80, y: 10 }]); acc -= Sim.TICK_DT; tick++; } }
    hashes.add(JSON.stringify(Sim.cloneState(w.s)));
  }
  ok(hashes.size === 1, 'física idêntica com quadros de 20/30/60/75/144/240 FPS (passo fixo de 60 Hz)');
}
// 2b. pilha real: cliente a 20 FPS entrega as entradas em rajadas; o servidor segue consistente (diferença pequena e limitada)
{
  const pos = [];
  for (const fps of [20, 60, 240]) {
    const ns = new NetSim({ map: 'v1' });
    const c = ns.addClient({ profile: { oneWay: 20, jitter: 2 }, fps, behavior: 'bot' });
    ns.addClient({ profile: { oneWay: 20, jitter: 2 }, behavior: 'idle' });
    c.inputNow = () => { const t = c.net.seq; return { x: (t % 120) < 60 ? 127 : -127, y: ((t >> 3) % 2) ? 60 : -60 }; };
    ns.room.start(); ns.run(12000);
    const p = ns.room.world.s.players[c.sc.slot]; pos.push({ fps, x: p.x, y: p.y, starved: c.sc.stats.starved, err: c.net.st.errAvg });
    ns.close();
  }
  const spread = Math.max(...pos.map(p => Math.hypot(p.x - pos[1].x, p.y - pos[1].y)));
  console.log('   ', pos.map(p => p.fps + 'fps: starved=' + p.starved + ' err=' + p.err.toFixed(3)).join(' | '));
  ok(spread < 1.0 && pos.every(p => p.err < 0.2), 'cliente a 20 FPS fica a ' + spread.toFixed(2) + ' m do de 60/240 FPS (só atraso de rajada, sem divergir)');
}
// 3. protocolo
{
  const w = Sim.create(MAPS.MAPS.v3, {}); Sim.addPlayer(w, 1); Sim.addPlayer(w, 2); Sim.addPlayer(w, 1);
  for (let i = 0; i < 300; i++) Sim.step(w, [{ x: 127, y: 0, kick: 0 }, { x: -50, y: 30 }, { x: 0, y: 0 }]);
  const basis = {}, f = Proto.encodeSnapshot(w.s, 7, 2, basis, true);
  const auth = Sim.cloneState(Sim.create(MAPS.MAPS.v3, {}).s);
  const mk = () => ({ present: false, team: 0, x: -100, y: -100, vx: 0, vy: 0, kickBuf: 0, passBuf: 0, lock: 0, lastAct: 0, ix: 0, iy: 0 });
  const meta = Proto.decodeSnapshot(f, auth, mk);
  ok(meta.full && meta.ack === 7 && auth.players[0].x === w.s.players[0].x && auth.ball.vx === w.s.ball.vx && auth.red === w.s.red, 'snapshot completo: ida e volta sem perda (float32 exato)');
  const authBeforeBad = JSON.stringify(auth); let truncatedSafe = true;
  for (let len = 0; len < f.length; len++) {
    try { if (Proto.decodeSnapshot(f.subarray(0, len), auth, mk) !== null || JSON.stringify(auth) !== authBeforeBad) truncatedSafe = false; }
    catch (e) { truncatedSafe = false; }
  }
  ok(truncatedSafe, 'prefixos truncados do snapshot são rejeitados sem exceção nem mutação parcial');
  const badNaN = f.slice(); new DataView(badNaN.buffer).setFloat32(34, NaN);
  ok(Proto.decodeSnapshot(badNaN, auth, mk) === null && JSON.stringify(auth) === authBeforeBad, 'snapshot com coordenada não finita é rejeitado sem contaminar o estado');
  const noAck = Proto.encodeSnapshot(w.s, -1, 0, {}, true);
  const noAckMeta = Proto.decodeSnapshot(noAck, Sim.cloneState(Sim.create(MAPS.MAPS.v3, {}).s), mk);
  ok(noAckMeta.ack === -1, 'ACK inicial -1 preservado como sentinela (não vira 4294967295)');
  Sim.step(w, [{ x: 127, y: 0 }, { x: -50, y: 30 }, { x: 0, y: 0 }]);
  const d = Proto.encodeSnapshot(w.s, 8, 2, basis, false);
  ok(d.length < f.length, 'delta menor que o completo (' + d.length + ' < ' + f.length + ' bytes)');
  Proto.decodeSnapshot(d, auth, mk);
  ok(auth.players[1].x === w.s.players[1].x && auth.tick === w.s.tick, 'delta aplicado reproduz o estado do servidor');
  let threw = false; try { for (let i = 0; i < 20000; i++) { const b = new Uint8Array(1 + (Math.random() * 60 | 0)).map(() => Math.random() * 256); b[0] = Math.random() < .5 ? 1 : (Math.random() * 6 | 0); Proto.decodeInputs(b); } } catch (e) { threw = true; }
  ok(!threw, 'decodeInputs nunca lança com bytes aleatórios (fuzz 20 mil)');
  ok(Proto.decodeInputs(new Uint8Array([1, 2, 0, 0, 0, 1, 0, 0, 0])) === null, 'pacote de entrada com tamanho errado é rejeitado');
}
// 3b. buffer de renderização: clientes preditivos não guardam snapshots que não usam; espectadores interpolam
{
  const ns = new NetSim({ map: 'v1' });
  const active = ns.addClient({ profile: { oneWay: 10, jitter: 1 }, predict: true, behavior: 'idle' });
  const spectator = ns.addClient({ profile: { oneWay: 10, jitter: 1 }, predict: true, team: 0, behavior: 'idle' });
  ns.room.start(); ns.run(1800);
  const render = spectator.net.getRender();
  ok(active.net.hasBase && active.net.snapBuf.length === 0, 'cliente ativo preditivo reconcilia sem reter buffer de interpolação');
  ok(spectator.net.slot < 0 && spectator.net.snapBuf.length > 0 && render && render.pos.length >= 2, 'espectador mantém snapshots e produz posição interpolada');
  const local = active.net.getRender();
  ok(local && local.pos.length === 2 + active.net.w.s.players.length * 2 && local.pos.every(Number.isFinite), 'render preditivo mantém formato e posições finitas');
  const net = spectator.net, now = ns.t, lastAt = now - 1000 / 120;
  const history = omitBeforeJoin => {
    const out = [];
    for (let tick = 1; tick <= 8; tick++) {
      const ents = [{ x: 0, y: 0 }];
      if (!omitBeforeJoin || tick >= 3) ents.push({ x: tick >= 3 ? 12 : -100, y: tick >= 3 ? -4 : -100, present: tick >= 3, team: tick >= 3 ? 1 : 0 });
      out.push({ tick, at: lastAt - (8 - tick) * (1000 / 60), ents, st: { players: [{ present: true }] } });
    }
    return out;
  };
  net.snapBuf = history(true);
  const joined = net.getRender();
  ok(joined && joined.pos.length === 4 && joined.pos[2] === 12 && joined.pos[3] === -4, 'jogador recém-adicionado recebe posição definida no buffer do espectador');
  net.snapBuf = history(false);
  const toggled = net.getRender();
  ok(toggled && toggled.pos[2] === 12 && toggled.pos[3] === -4, 'entrada de jogador não interpola a partir do sentinela fora de campo');
  ns.close();
}
// 3c. WebSocket: o limite de payload também vale para a mensagem fragmentada inteira
{
  class FakeSocket extends EventEmitter {
    constructor() { super(); this.writes = []; this.writableLength = 0; }
    setNoDelay() {} setTimeout() {} write(b) { this.writes.push(Buffer.from(b)); return true; }
    end() {} destroy() {}
  }
  const makeFrame = (fin, opcode, text) => {
    const payload = Buffer.from(text), mask = Buffer.from([3, 7, 11, 19]);
    const frame = Buffer.alloc(2 + 4 + payload.length);
    frame[0] = (fin ? 0x80 : 0) | opcode; frame[1] = 0x80 | payload.length; mask.copy(frame, 2);
    for (let i = 0; i < payload.length; i++) frame[6 + i] = payload[i] ^ mask[i & 3];
    return frame;
  };
  const socket = new FakeSocket(), ws = new WSConn(socket, 5), received = [];
  ws.on('message', (data, bin) => received.push({ data, bin }));
  ws._onData(makeFrame(false, 1, 'ab')); ws._onData(makeFrame(true, 0, 'cde'));
  ok(received.length === 1 && received[0].data === 'abcde' && !received[0].bin && ws.fragBytes === 0, 'mensagem fragmentada dentro do limite é remontada');
  const badSocket = new FakeSocket(), bad = new WSConn(badSocket, 5);
  bad._onData(makeFrame(false, 1, '12345')); bad._onData(makeFrame(true, 0, 'x'));
  const closeFrame = badSocket.writes[badSocket.writes.length - 1];
  ok(!bad.open && bad.frag === null && bad.fragBytes === 0 && closeFrame[0] === 0x88 && closeFrame.readUInt16BE(2) === 1009,
    'payload fragmentado acima do limite encerra com 1009 e libera os fragmentos');
  ws.close(1000);
}
// 4. sala: validação
{
  const r = mkRoom(); const c1 = fakeConn(), c2 = fakeConn();
  const a = r.join(c1, { nick: 'A' }).client, b = r.join(c2, { nick: 'B' }).client;
  ok(a.slot !== b.slot && a.team !== b.team, 'times balanceados automaticamente');
  r.onMessage(a, '{lixo', false); r.onMessage(a, '"x"', false); r.onMessage(a, JSON.stringify({ t: 'nope' }), false);
  ok(r.m.invalid === 3, 'JSON inválido / tipo desconhecido contados como inválidos');
  r.start();
  r.onMessage(a, inp(5, 127, 0), true); r.onMessage(a, inp(5, -127, 0), true); r.onMessage(a, inp(3, 0, 0), true);
  ok(a.queue.length === 1 && a.stats.dup === 2, 'seq repetida/antiga descartada (anti replay)');
  r.onMessage(a, inp(900000, 0, 0), true);
  ok(r.m.invalid === 4, 'salto absurdo de seq é inválido');
  // flood
  const f = fakeConn(); const r2 = mkRoom(); const x = r2.join(f, { nick: 'F' }).client;
  for (let i = 0; i < 2000; i++) r2.onMessage(x, new Uint8Array([9]), true);
  ok(f.closed || r2.m.invalid > 100, 'flood de mensagens derruba/limita o cliente');
  // senha, lotação
  const rp = mkRoom({ password: 'segredo', max: 2 });
  ok(rp.join(fakeConn(), { nick: 'x', password: 'errada' }).error === 'Senha incorreta.', 'senha errada recusada');
  ok(rp.join(fakeConn(), { nick: 'x', password: 'segredo' }).client && rp.join(fakeConn(), { nick: 'y', password: 'segredo' }).client && rp.join(fakeConn(), { nick: 'z', password: 'segredo' }).error === 'Sala cheia.', 'sala cheia recusa');
  // XSS no nick
  const rx = mkRoom(); const xc = rx.join(fakeConn(), { nick: '<img onerror=alert(1)>' }).client;
  ok(!/[<>]/.test(xc.nick), 'nick sanitizado (' + xc.nick + ')');
}
// 5. anti speed-hack e chutes preservados
{
  const r = mkRoom(); const c = fakeConn(); const a = r.join(c, { nick: 'A' }).client; r.join(fakeConn(), { nick: 'B' });
  r.start(); for (let i = 0; i < 200; i++) r.tick();      // passa a contagem
  const x0 = r.world.s.players[a.slot].x;
  // cliente trapaceiro manda 5 ticks de entrada por tick do servidor
  let seq = 0;
  for (let t = 0; t < 60; t++) { const list = []; for (let k = 0; k < 5; k++) list.push({ seq: seq++, x: a.team === 1 ? 127 : -127, y: 0, kick: k === 0 && t === 30 ? 1 : 0, pass: 0 }); r.onMessage(a, Proto.encodeInputs(list), true); r.tick(); }
  const moved = Math.abs(r.world.s.players[a.slot].x - x0);
  ok(moved < 4.9 * 1.05 + 0.2, 'speed-hack (5x entradas) não acelera o jogador: andou ' + moved.toFixed(2) + ' m em 1 s (máx 4,9)');
  ok(a.stats.trimmed > 0, 'excesso de entradas foi descartado pelo servidor');
}
// 6. migração de dono + fim por tempo + espectador
{
  const r = mkRoom(); const a = r.join(fakeConn(), { nick: 'A' }).client, b = r.join(fakeConn(), { nick: 'B' }).client;
  ok(r.admin() === a, 'primeiro a entrar é o dono');
  r.leave(a); ok(r.admin() === b, 'dono saiu: dono migra para o jogador mais antigo (sem perder a partida)');
  r.onMessage(b, JSON.stringify({ t: 'team', team: 0 }), false);
  ok(b.slot === -1, 'jogador pode virar espectador');
}
// 7. ranqueada: estranho não entra, ausente perde, resultado vem do servidor
{
  let res = null; const r = new Room({ id: 'r', name: 'rk', mapKey: 'v1', max: 4, ranked: { mode: 'v1', users: { u1: 1, u2: 2 }, matches: {} }, scoreLimit: 5, timeLimit: 5 }, { onRankedEnd: (rm, x) => { res = x; } });
  ok(r.join(fakeConn(), { nick: 'intruso', user: { id: 'u9' } }).error, 'estranho não entra em partida ranqueada');
  ok(r.join(fakeConn(), { nick: 'x' }).error, 'anônimo não entra em partida ranqueada');
  const c1 = r.join(fakeConn(), { nick: 'U1', user: { id: 'u1' } }).client;
  const realNow = Date.now; let t = realNow(); Date.now = () => t;
  try { r.rankedDeadline = t + 1000; t += 2000; r.tick(); } finally { Date.now = realNow; }
  ok(res && res.forfeitBy === 'u2' && res.red === 3 && res.blue === 0, 'adversário que não aparece perde por W.O. (3x0 para quem estava)');
}
console.log(fail ? '\n' + fail + ' FALHA(S) de ' + n : '\nTODOS OS ' + n + ' TESTES PASSARAM');
process.exit(fail ? 1 : 0);
