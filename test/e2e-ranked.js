'use strict';
/* Ranqueada humano x humano ponta a ponta: 2 contas, fila, pareamento, aceitar, sala autoritativa por WebSocket (com cookie de sessão).
   Um jogador cai e não volta: o servidor aplica W.O. e atualiza os pontos dos DOIS. */
const { spawn } = require('child_process'), path = require('path'), os = require('os'), fs = require('fs');
const { Client } = require('../game/netclient.js'); const { MAPS } = require('../server/room.js');
const PORT = 19600 + Math.floor(Math.random() * 300), data = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-rk-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, FUTHUB_DATA: data, FUTHUB_RANKED_GRACE_MS: '3000', FUTHUB_DEBUG: '1' }), stdio: ['ignore', 'pipe', 'inherit'] });
const sleep = ms => new Promise(r => setTimeout(r, ms)); let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const base = 'http://127.0.0.1:' + PORT;
async function call(cookie, p, method, body) {
  const r = await fetch(base + p, { method: method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); const sc = r.headers.get('set-cookie'); return { status: r.status, j, cookie: sc ? sc.split(';')[0] : cookie };
}
(async () => {
  await new Promise(r => srv.stdout.on('data', d => /rodando/.test(String(d)) && r()));
  const A = await call(null, '/api/register', 'POST', { username: 'jogadora', password: 'senha1234', nick: 'Jô' });
  const B = await call(null, '/api/register', 'POST', { username: 'jogador2', password: 'senha1234', nick: 'Zé' });
  ok(A.status === 201 && B.status === 201, 'duas contas criadas');
  await call(A.cookie, '/api/queue/join', 'POST', { mode: 'v1' }); await call(B.cookie, '/api/queue/join', 'POST', { mode: 'v1' });
  let sa, sb; for (let i = 0; i < 15; i++) { await sleep(1000); sa = (await call(A.cookie, '/api/queue/status')).j; sb = (await call(B.cookie, '/api/queue/status')).j; if (sa.state === 'matched' && sb.state === 'matched') break; }
  ok(sa.state === 'matched' && !sa.opponent.bot && sa.online, 'pareou humano x humano (online=true)');
  const ra = await call(A.cookie, '/api/queue/accept', 'POST'), rb = await call(B.cookie, '/api/queue/accept', 'POST');
  ok(ra.j.online && ra.j.online.room === rb.j.online.room && ra.j.online.team !== rb.j.online.team, 'os dois caem na MESMA sala autoritativa, em times opostos');
  const connect = (cookie, room, nick) => new Promise(res => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws', { headers: { Cookie: cookie } }); ws.binaryType = 'arraybuffer'; const log = [];
    const net = new Client({ now: () => performance.now(), send: d => ws.readyState === 1 && ws.send(d), getMap: k => MAPS.MAPS[k], input: () => ({ x: 0, y: 0 }), onMsg: m => log.push(m) });
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', room }));
    ws.onmessage = ev => { const d = ev.data; net.onMessage(typeof d === 'string' ? d : new Uint8Array(d), typeof d !== 'string'); };
    let last = performance.now(); const iv = setInterval(() => { const n = performance.now(); net.frame(n - last); last = n; }, 8);
    res({ ws, net, log, stop: () => { clearInterval(iv); ws.close(); } });
  });
  const intruder = await call(null, '/api/register', 'POST', { username: 'intruso1', password: 'senha1234' });
  const ci = await connect(intruder.cookie, ra.j.online.room); await sleep(400);
  ok(ci.log.some(m => m.t === 'bye'), 'terceiro usuário é barrado da sala ranqueada');
  const ca = await connect(A.cookie, ra.j.online.room), cb = await connect(B.cookie, ra.j.online.room);
  await sleep(1000);
  ok(ca.net.started && cb.net.started, 'partida começa sozinha quando os dois conectam');
  // falsificação: placar enviado pelo navegador numa partida contra humano deve ser recusado e NÃO consumir a partida
  const forged = await call(A.cookie, '/api/ranked/finish', 'POST', { matchId: ra.j.matchId, red: 5, blue: 0 });
  const forgedB = await call(B.cookie, '/api/ranked/finish', 'POST', { matchId: rb.j.matchId, red: 0, blue: 5 });
  ok(forged.status === 409 && forgedB.status === 409, 'placar forjado (5x0) via REST recusado com 409');
  ok((await call(A.cookie, '/api/me')).j.user.stats.v1 === undefined || (await call(A.cookie, '/api/me')).j.user.stats.v1.rating === 800, 'forja não alterou pontos');
  const abB = await call(B.cookie, '/api/ranked/finish', 'POST', { matchId: rb.j.matchId, abandon: true });
  ok(abB.status === 200 && abB.j.abandoned, 'abandono via REST (o cliente usa ao sair) continua permitido');
  cb.stop();                                   // Zé cai e não volta
  await sleep(6500);
  const endA = ca.log.find(m => m.t === 'end'), rkA = ca.log.find(m => m.t === 'ranked');
  ok(endA && endA.ended === 'forfeit', 'servidor encerra por W.O. depois da tolerância');
  ok(rkA && rkA.r.result === 'win' && rkA.r.delta > 0, 'quem ficou ganha pontos (+' + (rkA && rkA.r.delta) + ') calculados pelo servidor');
  const meB = (await call(B.cookie, '/api/me')).j.user.stats.v1, meA = (await call(A.cookie, '/api/me')).j.user.stats.v1;
  ok(meB.losses === 1 && meB.rating < 800 && meA.wins === 1 && meA.rating > 800, 'pontos gravados: Jô ' + meA.rating + ' / Zé ' + meB.rating);
  ca.stop(); srv.kill(); console.log(fail ? 'FALHOU ' + fail : 'TUDO OK'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
