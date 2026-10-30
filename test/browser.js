'use strict';
/* Teste de navegador (Playwright/Chromium): duas abas entram numa sala online, jogam e conferem o canvas/placar. */
const { chromium } = require('playwright');
const { spawn } = require('child_process'), path = require('path'), os = require('os'), fs = require('fs');
const PORT = 19000 + Math.floor(Math.random() * 500), data = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-br-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, FUTHUB_DATA: data, FUTHUB_DEBUG: '1' }), stdio: ['ignore', 'pipe', 'inherit'] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await new Promise(r => srv.stdout.on('data', d => /rodando/.test(String(d)) && r()));
  const br = await chromium.launch(); const errs = [];
  const mk = async (nick, shot) => {
    const ctx = await br.newContext({ viewport: { width: 1100, height: 650 } }), pg = await ctx.newPage();
    pg.on('pageerror', e => errs.push(nick + ': ' + e.message)); pg.on('console', m => m.type() === 'error' && errs.push(nick + ' console: ' + m.text()));
    await pg.goto('http://127.0.0.1:' + PORT + '/');
    await pg.evaluate(n => { state.nick = n; state.avatar = n.slice(0, 2).toUpperCase(); }, nick);
    return pg;
  };
  const A = await mk('Ana'), B = await mk('Beto');
  const room = await A.evaluate(async () => (await (await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'br', map: 'v1', max: 6, score: 5, time: 1 }) })).json()).room);
  await A.evaluate(id => FH_ONLINE.join(id), room.id); await sleep(400);
  await B.evaluate(id => FH_ONLINE.join(id), room.id); await sleep(500);
  console.log('A roomPlayers', await A.evaluate(() => roomPlayers.map(p => p.nick + ':' + p.team + (p.owner ? '*' : ''))));
  await A.screenshot({ path: process.argv[2] ? process.argv[2] + '/room.png' : '/tmp/room.png' });
  await A.evaluate(() => document.getElementById('startRoom').click()); await sleep(1200);
  console.log('mode', await A.evaluate(() => mode + ' engine.online=' + !!(engine && engine.online)));
  await sleep(3200);
  await A.keyboard.down('d'); await B.keyboard.down('a'); await sleep(1800); await A.keyboard.press(' '); await sleep(1000);
  const out = process.argv[2] || '/tmp';
  await A.screenshot({ path: out + '/game-A.png' }); await B.screenshot({ path: out + '/game-B.png' });
  const st = await A.evaluate(() => ({ red: engine.red, blue: engine.blue, time: Math.round(engine.time), ping: document.getElementById('pingDisplay').textContent, title: document.getElementById('pingDisplay').title, players: engine.players.length, ball: [engine.ball.x.toFixed(2), engine.ball.y.toFixed(2)] }));
  const stB = await B.evaluate(() => ({ ball: [engine.ball.x.toFixed(2), engine.ball.y.toFixed(2)], players: engine.players.length }));
  console.log('A', JSON.stringify(st)); console.log('B', JSON.stringify(stB));
  console.log('erros JS:', errs.length ? errs : 'nenhum');
  await br.close(); srv.kill(); process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
