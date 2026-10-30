'use strict';
/* Teste ponta a ponta com sockets reais: sobe o server.js, cria sala por REST, conecta 2 clientes por
   WebSocket (cliente de rede real, tempo real), joga alguns segundos e confere placar/estado. */
const { spawn } = require('child_process'), path = require('path'), os = require('os'), fs = require('fs');
const { Client } = require('../game/netclient.js');
const { MAPS } = require('../server/room.js');
const PORT = 18080 + Math.floor(Math.random() * 500);
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-e2e-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, FUTHUB_DATA: data, FUTHUB_DEBUG: '1' }), stdio: ['ignore', 'pipe', 'inherit'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  await new Promise(r => srv.stdout.on('data', d => /rodando/.test(String(d)) && r()));
  const base = 'http://127.0.0.1:' + PORT;
  const mk = await (await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'e2e', map: 'v1', max: 4, score: 5, time: 1 }) })).json();
  ok(mk.room && mk.room.id, 'sala criada via REST');
  const list = await (await fetch(base + '/api/rooms')).json();
  ok(list.rooms.length === 1 && list.rooms[0].name === 'e2e', 'sala aparece na lista');
  const mkClient = (name) => new Promise(res => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws'); ws.binaryType = 'arraybuffer';
    const t0 = performance.now(); let held = { x: 0, y: 0 };
    const net = new Client({ now: () => performance.now(), send: d => ws.readyState === 1 && ws.send(d), getMap: k => MAPS.MAPS[k], input: () => held });
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', room: mk.room.id, nick: name }));
    ws.onmessage = ev => { const d = ev.data; net.onMessage(typeof d === 'string' ? d : new Uint8Array(d), typeof d !== 'string'); };
    let last = performance.now(); const iv = setInterval(() => { const n = performance.now(); net.frame(n - last); last = n; }, 8);
    res({ ws, net, setInput: v => { held = v; }, stop: () => { clearInterval(iv); ws.close(); } });
  });
  const a = await mkClient('Ana'), b = await mkClient('Beto');
  await sleep(400);
  ok(a.net.slot >= 0 && b.net.slot >= 0 && a.net.slot !== b.net.slot, 'dois jogadores com vagas diferentes (' + a.net.slot + ',' + b.net.slot + ')');
  a.ws.send(JSON.stringify({ t: 'start' }));
  await sleep(300);
  ok(a.net.started && b.net.started, 'partida iniciada para ambos');
  // anda para o meio e chuta
  await sleep(3300);   // contagem
  a.setInput({ x: 127, y: 0 }); b.setInput({ x: -127, y: 0 });
  await sleep(2500);
  a.net.pressKick();
  await sleep(1500);
  const pa = a.net.getRender(), pb = b.net.getRender();
  ok(pa && pb, 'ambos têm estado para renderizar');
  const dBall = Math.hypot(pa.pos[0] - pb.pos[0], pa.pos[1] - pb.pos[1]);
  ok(dBall < 0.8, 'bola igual nos dois clientes (dif ' + dBall.toFixed(3) + ' m)');
  const m = await (await fetch(base + '/api/net/metrics')).json();
  console.log('metrics', JSON.stringify({ rooms: m.rooms, conns: m.conns, tickUsAvg: m.list[0].tickUsAvg, maxLateMs: m.maxLateMs, invalid: m.list[0].invalid, bytesSnap: m.list[0].bytesSnap }));
  ok(m.list[0].invalid === 0, 'nenhuma mensagem inválida');
  ok(a.net.st.snaps > 100, 'snapshots chegando (' + a.net.st.snaps + ', ' + a.net.st.snapHz.toFixed(1) + ' Hz)');
  console.log('rtt', a.net.st.rtt.toFixed(1), 'ms | erro de predição médio', a.net.st.errAvg.toFixed(4), 'm');
  // mensagens maliciosas
  const evil = new WebSocket('ws://127.0.0.1:' + PORT + '/ws'); await new Promise(r => evil.onopen = r);
  evil.send(new Uint8Array([1, 2, 3])); await sleep(200);
  ok(evil.readyState >= 2, 'binário antes do hello é rejeitado');
  const evil2 = new WebSocket('ws://127.0.0.1:' + PORT + '/ws'); await new Promise(r => evil2.onopen = r);
  evil2.send('{"t":"hello","room":"naoexiste"}'); await sleep(200);
  ok(evil2.readyState >= 2, 'sala inexistente fecha a conexão');
  a.stop(); b.stop(); srv.kill();
  console.log(fail ? 'FALHOU ' + fail : 'TUDO OK'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
