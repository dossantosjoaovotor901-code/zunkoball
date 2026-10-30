'use strict';
/* Exclusivos: lógica (JSON e MySQL simulado) + ponta a ponta (admin dá itens, jogador equipa, outros veem no roster). */
const { spawn } = require('child_process'), path = require('path'), os = require('os'), fs = require('fs');
const { Exclusives, SCHEMA } = require('../server/exclusives.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* pool MySQL falso: entende só as consultas que o MysqlStore faz */
function fakeMysql() {
  const T = { g: [], e: [], a: [] }, log = [];
  const pool = { async query(sql, p) {
    sql = sql.replace(/\s+/g, ' ').trim(); log.push(sql);
    if (/^CREATE TABLE/.test(sql)) return [[]];
    if (/FROM exclusive_grants$/.test(sql)) return [T.g.map(r => ({ uid: r.user_id, item: r.item_id, by: r.by, at: r.at }))];
    if (/FROM exclusive_equipped$/.test(sql)) return [T.e.map(r => ({ uid: r.user_id, slot: r.slot, item: r.item_id }))];
    if (/^INSERT IGNORE INTO exclusive_grants/.test(sql)) { if (!T.g.some(r => r.user_id === p[0] && r.item_id === p[1])) T.g.push({ user_id: p[0], item_id: p[1], by: p[2], at: p[3] }); return [{}]; }
    if (/^DELETE FROM exclusive_grants/.test(sql)) { T.g = T.g.filter(r => !(r.user_id === p[0] && r.item_id === p[1])); return [{}]; }
    if (/^INSERT INTO exclusive_equipped/.test(sql)) { T.e = T.e.filter(r => !(r.user_id === p[0] && r.slot === p[1])); T.e.push({ user_id: p[0], slot: p[1], item_id: p[2] }); return [{}]; }
    if (/^DELETE FROM exclusive_equipped/.test(sql)) { T.e = T.e.filter(r => !(r.user_id === p[0] && r.slot === p[1])); return [{}]; }
    if (/^INSERT INTO exclusive_audit/.test(sql)) { T.a.push({ at: p[0], admin: p[1], action: p[2], target: p[3], item: p[4] }); return [{}]; }
    if (/FROM exclusive_audit/.test(sql)) return [T.a.slice().reverse().slice(0, p[0])];
    throw new Error('SQL inesperado: ' + sql);
  } };
  return { createPool: () => pool, T, log };
}

async function logic(label, mk) {
  const x = mk(); await x.start();
  ok(x.status === 'ready', label + ': inicia pronto');
  ok(x.info('u1').items.length === 0, label + ': jogador novo não tem nada');
  await x.grant('u1', 'x-zk-gold', 'adm', 'joao'); await x.grant('u1', 'x-zk-gold', 'adm', 'joao');
  ok(x.has('u1', 'x-zk-gold') && x.ownedIds('u1').length === 1, label + ': entrega item (sem duplicar)');
  let err = null; try { await x.grant('u1', 'x-inexistente', 'adm', 'joao'); } catch (e) { err = e; }
  ok(err && err.status === 400, label + ': item inexistente é recusado');
  err = null; try { await x.equip('u2', 'kit', 'x-zk-gold'); } catch (e) { err = e; }
  ok(err && err.status === 403, label + ': não equipa item que não tem');
  err = null; try { await x.equip('u1', 'fx', 'x-zk-gold'); } catch (e) { err = e; }
  ok(err && err.status === 400, label + ': não equipa uniforme no espaço de efeito');
  await x.equip('u1', 'kit', 'x-zk-gold');
  ok(x.equippedOf('u1').kit === 'x-zk-gold', label + ': equipa o uniforme');
  await x.revoke('u1', 'x-zk-gold', 'adm', 'joao');
  ok(!x.has('u1', 'x-zk-gold') && x.equippedOf('u1').kit === null, label + ': remover item também desequipa');
  const au = await x.audit(10);
  ok(au.length === 2 && au[0].action === 'revoke', label + ': auditoria registra as ações (mais recente primeiro)');
  return x;
}

(async () => {
  const dbObj = { users: {} }; let saved = 0;
  await logic('json', () => new Exclusives({ db: dbObj, save: () => saved++, env: {}, log: () => {} }));
  ok(saved > 0 && dbObj.exclusives, 'json: grava no db.json');

  const fm = fakeMysql();
  const x = await logic('mysql(simulado)', () => new Exclusives({ db: {}, save() {}, env: { MYSQL_HOST: 'h', MYSQL_USER: 'u', MYSQL_PASSWORD: 'p', MYSQL_DATABASE: 'd' }, mysql: fm, log: () => {} }));
  ok(fm.log.filter(s => /^CREATE TABLE/.test(s)).length === SCHEMA.length, 'mysql: cria as ' + SCHEMA.length + ' tabelas');
  await x.grant('u9', 'x-explosao', 'adm', 'maria'); await x.equip('u9', 'fx', 'x-explosao');
  const x2 = new Exclusives({ db: {}, save() {}, env: { MYSQL_HOST: 'h' }, mysql: fm, log: () => {} }); await x2.start();
  ok(x2.has('u9', 'x-explosao') && x2.equippedOf('u9').fx === 'x-explosao', 'mysql: reinício do servidor recarrega concessões e itens equipados');

  // MySQL fora do ar: jogo segue, escrita é recusada com 503
  const down = new Exclusives({ db: {}, save() {}, env: { MYSQL_HOST: 'h' }, mysql: { createPool: () => ({ query: async () => { throw new Error('ECONNREFUSED'); } }) }, log: () => {} });
  await down.start(); clearTimeout(down.retryTimer);
  let e503 = null; try { await down.grant('u1', 'x-zk-gold', 'adm', 'a'); } catch (e) { e503 = e; }
  ok(down.status === 'offline' && e503 && e503.status === 503 && down.info('u1').items.length === 0, 'mysql fora do ar: leituras vazias e escrita recusada (503)');

  // ---- ponta a ponta ----
  const PORT = 19700 + Math.floor(Math.random() * 200), data = fs.mkdtempSync(path.join(os.tmpdir(), 'fh-excl-'));
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, FUTHUB_DATA: data, ZUNKO_ADMINS: 'chefe' }), stdio: ['ignore', 'pipe', 'inherit'] });
  const base = 'http://127.0.0.1:' + PORT;
  async function call(cookie, p, method, body) {
    const r = await fetch(base + p, { method: method || 'GET', headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}), body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); const sc = r.headers.get('set-cookie'); return { status: r.status, j, cookie: sc ? sc.split(';')[0] : cookie };
  }
  try {
    await new Promise(r => srv.stdout.on('data', d => /rodando/.test(String(d)) && r()));
    const adm = await call(null, '/api/register', 'POST', { username: 'chefe', password: 'senha123', nick: 'Chefe' });
    const pl = await call(null, '/api/register', 'POST', { username: 'craque', password: 'senha123', nick: 'Craque' });
    const ou = await call(null, '/api/register', 'POST', { username: 'outro', password: 'senha123', nick: 'Outro' });
    ok((await call(pl.cookie, '/api/admin/whoami')).j.admin === false, 'jogador comum não é admin');
    ok((await call(pl.cookie, '/api/admin/grant', 'POST', { username: 'craque', item: 'x-zk-gold' })).status === 403, 'jogador comum NÃO consegue se dar item (403)');
    ok((await call(null, '/api/admin/overview')).status === 401, 'sem login: 401');
    ok((await call(adm.cookie, '/api/admin/whoami')).j.admin === true, 'admin reconhecido pela variável ZUNKO_ADMINS');
    const ov = (await call(adm.cookie, '/api/admin/overview')).j; ok(ov.status === 'ready' && ov.catalog.length >= 18 && ov.catalog.filter(i => i.kind === 'fx').length >= 8 && ov.catalog.filter(i => i.kind === 'kit').length >= 10, 'painel: catálogo e banco prontos');
    ok((await call(adm.cookie, '/api/admin/players?q=crq')).j.players.length === 0 && (await call(adm.cookie, '/api/admin/players?q=craq')).j.players[0].username === 'craque', 'busca de jogador');
    // lista de TODOS os jogadores (sem busca), inclusive admin e o próprio admin
    const allp = (await call(adm.cookie, '/api/admin/players')).j;
    ok(allp.total === 3 && allp.players.length === 3, 'painel lista todos os jogadores sem precisar buscar');
    const admRow = allp.players.find(p => p.username === 'chefe');
    ok(admRow && admRow.admin === true && allp.admins === 1, 'contas de admin aparecem na lista (marcadas como admin)');
    ok(allp.players.filter(p => p.admin).length === 1 && allp.players.find(p => p.username === 'craque').admin === false, 'jogador comum vem sem a marca de admin');
    ok((await call(adm.cookie, '/api/admin/players?q=chef')).j.players[0].username === 'chefe', 'busca encontra o admin');
    ok((await call(adm.cookie, '/api/admin/players?limit=2')).j.players.length === 2 && (await call(adm.cookie, '/api/admin/players?limit=2&offset=2')).j.players.length === 1, 'paginação (limit/offset)');
    ok((await call(adm.cookie, '/api/admin/players?u=outro')).j.players[0].nick === 'Outro', 'busca exata por usuário (?u=)');
    ok((await call(pl.cookie, '/api/admin/players')).status === 403, 'jogador comum não consegue listar jogadores (403)');
    // admin dá item para si mesmo (inclusive "todos")
    ok((await call(adm.cookie, '/api/admin/grant', 'POST', { username: 'chefe', item: 'x-vortice' })).status === 200 && (await call(adm.cookie, '/api/me')).j.user.excl.items.length === 1, 'admin dá item a si mesmo');
    ok((await call(adm.cookie, '/api/admin/grant', 'POST', { username: 'chefe', item: '*' })).j.player.owned.length === ov.catalog.length, 'admin dá TODOS os itens (*) a um admin');
    ok((await call(adm.cookie, '/api/admin/revoke', 'POST', { username: 'chefe', item: '*' })).j.player.owned.length === 0, 'admin remove todos os itens (*)');
    ok((await call(pl.cookie, '/api/exclusives/equip', 'POST', { slot: 'kit', id: 'x-zk-gold' })).status === 403, 'sem o item não dá para equipar');
    ok((await call(adm.cookie, '/api/admin/grant', 'POST', { username: 'craque', item: 'x-zk-gold' })).status === 200, 'admin dá o uniforme');
    ok((await call(adm.cookie, '/api/admin/grant', 'POST', { username: 'craque', item: 'x-explosao' })).status === 200, 'admin dá a explosão');
    const me = (await call(pl.cookie, '/api/me')).j.user; ok(me.excl.items.length === 2, '/api/me já mostra os itens do jogador');
    ok((await call(pl.cookie, '/api/exclusives/equip', 'POST', { slot: 'kit', id: 'x-zk-gold' })).j.excl.equipped.kit === 'x-zk-gold', 'jogador equipa o uniforme');
    await call(pl.cookie, '/api/exclusives/equip', 'POST', { slot: 'fx', id: 'x-explosao' });

    const made = (await call(null, '/api/rooms', 'POST', { name: 'Teste exclusivos', max: 4, map: 'v3', style: 'futsal', score: 5, time: 5 })).j.room.id;
    const join = (cookie, nick) => new Promise(res => { const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/ws', cookie ? { headers: { Cookie: cookie } } : undefined); const log = [];
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', room: made, nick })); ws.onmessage = ev => { if (typeof ev.data === 'string') log.push(JSON.parse(ev.data)); }; res({ ws, log }); });
    const A = await join(pl.cookie, 'x'), B = await join(ou.cookie, 'y'); await sleep(600);
    const rost = B.log.filter(m => m.t === 'roster').pop().players, mine = rost.find(p => p.nick === 'Craque'), other = rost.find(p => p.nick === 'Outro');
    ok(mine && mine.kit === 'x-zk-gold' && mine.fx === 'x-explosao', 'OUTROS jogadores recebem o uniforme e o efeito no roster');
    ok(other && !other.kit && !other.fx, 'quem não tem exclusivo vem sem kit/efeito');
    const G = await join(null, 'Fraude'); await sleep(300);
    ok(!G.log.filter(m => m.t === 'roster').pop().players.find(p => p.nick === 'Fraude').kit, 'visitante (sem conta) não consegue forjar kit pelo WebSocket');
    A.ws.close(); B.ws.close(); G.ws.close();

    await call(adm.cookie, '/api/admin/revoke', 'POST', { username: 'craque', item: 'x-zk-gold' });
    const me2 = (await call(pl.cookie, '/api/me')).j.user; ok(me2.excl.items.length === 1 && me2.excl.equipped.kit === null, 'item removido some e é desequipado');
    const aud = (await call(adm.cookie, '/api/admin/audit')).j.audit; ok(aud.some(a => a.target === 'craque' && a.action === 'revoke' && a.item === 'x-zk-gold') && aud.filter(a => a.target === 'craque').length === 3, 'histórico do painel registra 2 entregas + 1 remoção');
    // itens novos: equipar um uniforme e um efeito novos
    await call(adm.cookie, '/api/admin/grant', 'POST', { username: 'craque', item: 'x-zk-neon' }); await call(adm.cookie, '/api/admin/grant', 'POST', { username: 'craque', item: 'x-raio' });
    const eq = (await call(pl.cookie, '/api/exclusives/equip', 'POST', { slot: 'fx', id: 'x-raio' })).j.excl;
    ok(eq.equipped.fx === 'x-raio' && eq.items.find(i => i.id === 'x-raio').rarity, 'novo efeito (Raio) é equipado e traz a raridade');
    ok((await call(pl.cookie, '/api/exclusives/equip', 'POST', { slot: 'kit', id: 'x-zk-neon' })).j.excl.equipped.kit === 'x-zk-neon', 'novo uniforme (ZK Neon) é equipado');
  } catch (e) { console.log('FAIL erro inesperado', e); fail++; }
  srv.kill(); process.exit(fail ? 1 : 0);
})();
