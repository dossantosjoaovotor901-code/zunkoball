'use strict';
/* Sala casual: pausa e reinício só pelo dono; dono sai de propósito = sala fecha e some da lista; visitante saindo não fecha. */
const { spawn } = require('child_process'), path = require('path'), os = require('os'), fs = require('fs');
const { Client } = require('../game/netclient.js'); const { MAPS, Room } = require('../server/room.js');
const PORT = 19300 + Math.floor(Math.random() * 300), data = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-room-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, FUTHUB_DATA: data }), stdio: ['ignore', 'pipe', 'inherit'] });
const sleep = ms => new Promise(r => setTimeout(r, ms)); let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const base = 'http://127.0.0.1:' + PORT;
const rest = async (p, body) => (await fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json();
const connect = (room, nick) => new Promise(res => {
  const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws'); ws.binaryType = 'arraybuffer'; const log = [];
  const net = new Client({ now: () => performance.now(), send: d => ws.readyState === 1 && ws.send(d), getMap: k => MAPS.MAPS[k], input: () => ({ x: 0, y: 0 }), onMsg: m => log.push(m) });
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', room, nick }));
  ws.onmessage = ev => { const d = ev.data; net.onMessage(typeof d === 'string' ? d : new Uint8Array(d), typeof d !== 'string'); };
  let last = performance.now(); const iv = setInterval(() => { const n = performance.now(); net.frame(n - last); last = n; }, 8);
  const send = o => ws.send(JSON.stringify(o));
  res({ ws, net, log, send, stop: () => { clearInterval(iv); try { ws.close(1000); } catch (e) {} } });
});
const tick = c => c.net.auth ? c.net.auth.tick : -1;
(async () => {
  await new Promise(r => srv.stdout.on('data', d => /rodando/.test(String(d)) && r()));
  const made = await rest('/api/rooms', { name: 'Feedback — Sala', max: 4, map: 'v3', style: 'futsal', score: 5, time: 5 });
  const id = made.room.id;
  const A = await connect(id, 'Dono'), B = await connect(id, 'Visita'); await sleep(500);
  ok(A.net.adminId === A.net.me, 'primeiro a entrar é o dono');
  A.send({ t: 'start' }); await sleep(1200);
  ok(A.net.started && B.net.started && tick(A) > 30, 'partida iniciada nos dois (tick ' + tick(A) + ')');

  // ping ao vivo para a tela da sala (a cada 3 s)
  await sleep(3300);
  const pg = A.log.filter(m => m.t === 'pings').pop();
  ok(pg && Object.keys(pg.p).length === 2 && Object.values(pg.p).every(v => typeof v === 'number'), 'servidor envia ping de todos os jogadores (sala mostra Ping ao vivo)');
  const rost = A.net.roster || []; ok(rost.length === 2 && rost.every(p => typeof p.rtt === 'number'), 'roster traz ping (rtt) de cada jogador');

  // pausa: visitante não pode; dono pode; simulação congela para os dois
  B.send({ t: 'pause' }); await sleep(300);
  const t0 = tick(A), t1 = (await sleep(400), tick(A));
  ok(!A.log.some(m => m.t === 'pause') && t1 > t0, 'visitante NÃO consegue pausar (jogo segue rodando)');
  A.send({ t: 'pause' }); await sleep(400);
  ok(A.log.some(m => m.t === 'pause' && m.on) && B.log.some(m => m.t === 'pause' && m.on), 'dono pausa: os dois são avisados');
  const p0 = tick(A); await sleep(800);
  ok(tick(A) === p0 && tick(B) === tick(A), 'servidor congelou a simulação (tick parado em ' + p0 + ')');
  A.send({ t: 'pause' }); await sleep(600);
  ok(A.log.filter(m => m.t === 'pause').pop().on === false && tick(A) > p0, 'dono retoma: simulação volta a andar');

  // reiniciar: visitante não pode; dono pode (tick volta a ~0 e há nova contagem)
  const before = tick(A); B.send({ t: 'restart' }); await sleep(300);
  ok(tick(A) >= before, 'visitante NÃO consegue reiniciar');
  A.send({ t: 'restart' }); await sleep(250);
  ok(tick(A) < before && A.log.filter(m => m.t === 'start').length >= 2 && B.log.filter(m => m.t === 'start').length >= 2, 'dono reinicia: nova partida para os dois (tick ' + before + ' -> ' + tick(A) + ')');

  // parar e iniciar novamente não pode reutilizar o estado de rede da partida anterior
  A.send({ t: 'stop' }); await sleep(350);
  ok(!A.net.started && !B.net.started && A.log.some(m => m.t === 'lobby') && B.log.some(m => m.t === 'lobby'), 'parar partida retorna os dois clientes à sala');
  A.send({ t: 'start' }); await sleep(900);
  ok(A.net.started && B.net.started && tick(A) > 10 && tick(B) > 10, 'parar e iniciar novamente funciona sem congelar (ticks ' + tick(A) + '/' + tick(B) + ')');

  // visitante sai de propósito: sala continua
  B.stop(); await sleep(500);
  ok((await rest('/api/rooms')).rooms.some(r => r.id === id), 'visitante saiu: a sala continua aberta');

  // dono sai de propósito: sala fecha e some da lista (sem esperar)
  const C = await connect(id, 'Outro'); await sleep(400);
  A.stop(); await sleep(600);
  ok(C.log.some(m => m.t === 'bye') , 'o dono saiu de propósito: demais jogadores recebem aviso de sala fechada');
  const list = (await rest('/api/rooms')).rooms;
  ok(!list.some(r => r.id === id), 'sala some da lista na hora (lista: ' + list.length + ' salas)');

  // queda de rede do dono (sem close frame) NÃO fecha a sala: dono migra
  const room = new Room({ id: 'x', name: 't', max: 4 }), mk = () => ({ send() {}, close() {}, buffered: 0 });
  const o1 = room.join(mk(), { nick: 'o1' }).client, o2 = room.join(mk(), { nick: 'o2' }).client;
  room.leave(o1, 'drop');
  ok(!room.closing && room.admin() === o2, 'queda de rede do dono: sala não fecha e o dono migra');
  room.leave(o2, 'leave');
  ok(room.closing, 'último jogador saiu de propósito (dono): sala fecha');
  C.stop(); srv.kill(); console.log(fail ? 'FALHOU ' + fail : 'TUDO OK'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
