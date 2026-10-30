'use strict';
/* Bordas da ranqueada humano x humano: (1) os dois aceitam e NINGUÉM conecta -> anulada, sem pontos;
   (2) aceite tardio numa sala já anulada -> recusado (409) e sem partida pendente/derrota indevida. */
const { spawn } = require('child_process'), path = require('path'), os = require('os'), fs = require('fs');
const { Client } = require('../game/netclient.js'); const { MAPS } = require('../server/room.js');
const PORT = 19400 + Math.floor(Math.random() * 300), data = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-edge-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, FUTHUB_DATA: data, FUTHUB_RANKED_JOIN_MS: '2000', FUTHUB_RANKED_GRACE_MS: '3000' }), stdio: ['ignore', 'pipe', 'inherit'] });
const sleep = ms => new Promise(r => setTimeout(r, ms)); let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const base = 'http://127.0.0.1:' + PORT;
async function call(cookie, p, method, body) {
  const r = await fetch(base + p, { method: method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); const sc = r.headers.get('set-cookie'); return { status: r.status, j, cookie: sc ? sc.split(';')[0] : cookie };
}
const connect = (cookie, room) => new Promise(res => {
  const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws', { headers: { Cookie: cookie } }); ws.binaryType = 'arraybuffer'; const log = [];
  const net = new Client({ now: () => performance.now(), send: d => ws.readyState === 1 && ws.send(d), getMap: k => MAPS.MAPS[k], input: () => ({ x: 0, y: 0 }), onMsg: m => log.push(m) });
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', room }));
  ws.onmessage = ev => { const d = ev.data; net.onMessage(typeof d === 'string' ? d : new Uint8Array(d), typeof d !== 'string'); };
  let last = performance.now(); const iv = setInterval(() => { const n = performance.now(); net.frame(n - last); last = n; }, 8);
  res({ ws, net, log, stop: () => { clearInterval(iv); ws.close(); } });
});
async function pair(u1, u2) {
  const A = await call(null, '/api/register', 'POST', { username: u1, password: 'senha1234' });
  const B = await call(null, '/api/register', 'POST', { username: u2, password: 'senha1234' });
  await call(A.cookie, '/api/queue/join', 'POST', { mode: 'v1' }); await call(B.cookie, '/api/queue/join', 'POST', { mode: 'v1' });
  for (let i = 0; i < 15; i++) { await sleep(1000); const sa = (await call(A.cookie, '/api/queue/status')).j, sb = (await call(B.cookie, '/api/queue/status')).j; if (sa.state === 'matched' && sb.state === 'matched') break; }
  return { A, B };
}
const games = async c => { const s = (await call(c, '/api/me')).j.user.stats.v1; return s ? s.games : 0; };
const openMatches = () => { try { return Object.keys(JSON.parse(fs.readFileSync(path.join(data, 'db.json'), 'utf8')).openMatches || {}).length; } catch (e) { return -1; } };
(async () => {
  await new Promise(r => srv.stdout.on('data', d => /rodando/.test(String(d)) && r()));
  // (1) os dois aceitam, ninguém conecta
  let { A, B } = await pair('ana1', 'bia22');
  await call(A.cookie, '/api/queue/accept', 'POST'); await call(B.cookie, '/api/queue/accept', 'POST');
  await sleep(5000);
  ok(await games(A.cookie) === 0 && await games(B.cookie) === 0, 'ninguém conectou: partida anulada, nenhum dos dois ganha/perde pontos');
  await sleep(500); ok(openMatches() === 0, 'nenhuma partida aberta pendente após anulação');
  // (2) aceite tardio: C aceita e conecta; D só aceita depois que a sala foi anulada
  ({ A, B } = await pair('cris3', 'duda4'));
  const rc = await call(A.cookie, '/api/queue/accept', 'POST');
  const cc = await connect(A.cookie, rc.j.online.room); await sleep(5000);
  ok(cc.log.some(m => m.t === 'ranked' && m.r.void), 'quem aceitou e conectou recebe "anulada, sem pontos"');
  const rd = await call(B.cookie, '/api/queue/accept', 'POST');
  ok(rd.status === 409, 'aceite tardio recusado (409)');
  await sleep(500); ok(openMatches() === 0, 'aceite tardio não deixou derrota pendente no banco');
  ok(await games(A.cookie) === 0 && await games(B.cookie) === 0, 'ninguém perdeu pontos');
  await sleep(3000);
  const m = (await call(null, '/api/net/metrics')); // sem FUTHUB_DEBUG: só localhost, que é o caso
  ok(m.status === 200 && m.j.rooms === 0, 'salas encerradas foram removidas (sem sala zumbi)');
  cc.stop(); srv.kill(); console.log(fail ? 'FALHOU ' + fail : 'TUDO OK'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
