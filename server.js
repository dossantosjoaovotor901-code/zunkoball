'use strict';
require('./server/env');   // carrega o .env (ZUNKO_ADMINS, MySQL...)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { db, save } = require('./server/db');
const auth = require('./server/auth');
const rk = require('./server/ranking');
const mm = require('./server/matchmaking');
const { GameServer } = require('./server/gameserver');
const { Exclusives } = require('./server/exclusives');
const { ReplayStore, validate: validateReplay, MAX_BYTES: REPLAY_MAX_BYTES } = require('./server/replay');

const root = path.join(__dirname, 'game'), port = process.env.PORT || 8080;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
/* Admins: nomes de usuário separados por vírgula em ZUNKO_ADMINS (ex.: ZUNKO_ADMINS=feedback,maria). Sem a variável, ninguém é admin. */
const ADMINS = new Set(String(process.env.ZUNKO_ADMINS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
const excl = new Exclusives({ db, save, env: process.env });
excl.start().catch(e => console.error('[exclusivos]', e));

const ip = req => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
const secure = req => req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');

function send(res, status, obj, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(JSON.stringify(obj));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject({ status: 415, error: 'Use application/json.' });
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 10240) { reject({ status: 413, error: 'Corpo muito grande.' }); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { const j = JSON.parse(Buffer.concat(chunks).toString() || '{}'); resolve(j && typeof j === 'object' ? j : {}); } catch (e) { reject({ status: 400, error: 'JSON inválido.' }); } });
    req.on('error', () => reject({ status: 400, error: 'Requisição inválida.' }));
  });
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
const cookieHeader = (req, token, maxAge) =>
  `fh_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` + (secure(req) ? '; Secure' : '');

/* ===== servidor de partidas online (WebSocket /ws + salas) ===== */
const replayStore = new ReplayStore({ db, save });
const gs = new GameServer({
  ip,
  appVersion: require('./package.json').version,
  saveReplay: rec => { try { return replayStore.put(rec); } catch (e) { console.error('saveReplay', e); return null; } },
  getUser: req => { const s = auth.getSession(cookies(req).fh_session); if (!(s && s.user)) return null; const eq = excl.equippedOf(s.user.id); return { id: s.user.id, nick: s.user.nick, avatar: s.user.avatar, kit: eq.kit, fx: eq.fx }; },
  onRankedEnd: (room, result) => {
    const pairUsers = room.ranked.users, matches = room.ranked.matches || {};
    const forfeiter = result.forfeitBy;
    if (result.void) {          // ninguém conectou a tempo: sem pontos para ninguém
      for (const uid of Object.keys(pairUsers)) {
        const u = db.users[uid], mid = matches[uid]; if (!u || !mid) continue;
        rk.voidMatch(u, mid);
        for (const c of room.clients.values()) if (c.uid === uid) room._send(c, JSON.stringify({ t: 'ranked', r: { void: true, reason: 'Nenhum jogador conectou a tempo. Sem pontos.' } }));
      }
      return;
    }
    const absentNeverAccepted = forfeiter && !matches[forfeiter];
    for (const uid of Object.keys(pairUsers)) {
      const u = db.users[uid], mid = matches[uid];
      if (!u || !mid) continue;
      let out;
      if (absentNeverAccepted) { rk.voidMatch(u, mid); out = { void: true, reason: 'O adversário não confirmou a partida. Sem pontos.' }; }
      else {
        const team = pairUsers[uid], own = team === 1 ? result.red : result.blue, opp = team === 1 ? result.blue : result.red;
        out = rk.finishAuthoritative(u, mid, own, opp, forfeiter === uid) || { void: true, reason: 'Partida já encerrada.' };
      }
      for (const c of room.clients.values()) if (c.uid === uid) room._send(c, JSON.stringify({ t: 'ranked', r: out }));
    }
  }
});
mm.hooks.createRankedRoom = pair => {
  const info = rk.MODES[pair.mode];
  const made = gs.createRoom({ name: 'Ranqueada', mapKey: pair.mode, style: info.group === 'real' ? 'real' : 'futsal', scoreLimit: info.rules.score,
    timeLimit: info.rules.time, max: info.requiredPlayers, ranked: { mode: pair.mode, requiredPlayers: info.requiredPlayers, users: pair.users, matches: pair.matches } });
  return made;
};

const publicUser = u => ({ id: u.id, username: u.username, nick: u.nick, avatar: u.avatar, stats: rk.publicStats(u), excl: excl.info(u.id) });
const adminPlayer = u => ({ id: u.id, username: u.username, nick: u.nick, avatar: u.avatar, admin: ADMINS.has(u.username), owned: excl.ownedIds(u.id), equipped: excl.equippedOf(u.id) });

async function api(req, res, url) {
  const route = req.method + ' ' + url.pathname;
  const token = cookies(req).fh_session;
  const sess = auth.getSession(token);
  const user = sess && sess.user;
  const need = () => { if (!user) { send(res, 401, { error: 'Faça login para continuar.' }); return false; } return true; };
  const adminOnly = () => { if (!need()) return false; if (!ADMINS.has(user.username)) { send(res, 403, { error: 'Acesso restrito a administradores.' }); return false; } return true; };

  // replays com id no caminho (download / tocar / apagar) — só o participante acessa
  const rep = url.pathname.match(/^\/api\/replays\/([a-zA-Z0-9_-]{1,40})(\/file)?$/);
  if (rep) {
    if (!need()) return;
    const id = rep[1];
    if (req.method === 'GET') {
      const buf = replayStore.read(id, user.id);
      if (!buf) return send(res, 404, { error: 'Replay não encontrado.' });
      const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
      if (rep[2]) headers['Content-Disposition'] = 'attachment; filename="zunkoball-' + id + '.fhreplay"';
      res.writeHead(200, headers);
      return res.end(buf);
    }
    if (req.method === 'DELETE') {
      const ok = replayStore.remove(id, user.id);
      return send(res, ok ? 200 : 404, ok ? { ok: true } : { error: 'Replay não encontrado.' });
    }
    return send(res, 405, { error: 'Método não permitido.' });
  }

  try {
    switch (route) {
      case 'POST /api/register': {
        if (!auth.rateLimit('reg:' + ip(req), 10, 3600e3)) return send(res, 429, { error: 'Muitas contas criadas deste dispositivo. Tente mais tarde.' });
        const b = await readJson(req);
        const username = String(b.username || '').trim().toLowerCase();
        const err = auth.validateCredentials(username, b.password);
        if (err) return send(res, 400, { error: err });
        if (Object.values(db.users).some(u => u.username === username)) return send(res, 409, { error: 'Esse usuário já existe.' });
        const u = { id: crypto.randomBytes(8).toString('hex'), username, nick: auth.cleanNick(b.nick, username), avatar: auth.cleanAvatar(b.avatar),
          pass: await auth.hashPassword(b.password), createdAt: Date.now(), stats: {} };
        db.users[u.id] = u; save();
        const t = auth.createSession(u.id);
        return send(res, 201, { user: publicUser(u) }, { 'Set-Cookie': cookieHeader(req, t, 30 * 86400) });
      }
      case 'POST /api/login': {
        const b = await readJson(req);
        const username = String(b.username || '').trim().toLowerCase();
        if (!auth.rateLimit('lip:' + ip(req), 30, 600e3) || !auth.rateLimit('lus:' + username, 8, 900e3))
          return send(res, 429, { error: 'Muitas tentativas. Aguarde alguns minutos.' });
        const u = Object.values(db.users).find(x => x.username === username);
        // compara mesmo se o usuário não existir (evita revelar quais contas existem pelo tempo de resposta)
        const ok = await auth.checkPassword(String(b.password || ''), u ? u.pass : '00:00');
        if (!u || !ok) return send(res, 401, { error: 'Usuário ou senha incorretos.' });
        const t = auth.createSession(u.id);
        return send(res, 200, { user: publicUser(u) }, { 'Set-Cookie': cookieHeader(req, t, 30 * 86400) });
      }
      case 'POST /api/logout':
        auth.destroySession(token);
        return send(res, 200, { ok: true }, { 'Set-Cookie': cookieHeader(req, '', 0) });
      case 'GET /api/me':
        return send(res, 200, { user: user ? publicUser(user) : null });
      case 'PATCH /api/profile': {
        if (!need()) return;
        const b = await readJson(req);
        if (b.nick != null) user.nick = auth.cleanNick(b.nick, user.username);
        if (b.avatar != null) user.avatar = auth.cleanAvatar(b.avatar);
        save();
        return send(res, 200, { user: publicUser(user) });
      }
      case 'POST /api/password': {
        if (!need()) return;
        const b = await readJson(req);
        if (!auth.rateLimit('pw:' + user.id, 5, 900e3)) return send(res, 429, { error: 'Muitas tentativas.' });
        if (!(await auth.checkPassword(String(b.old || ''), user.pass))) return send(res, 401, { error: 'Senha atual incorreta.' });
        const err = auth.validateCredentials(user.username, b.new);
        if (err) return send(res, 400, { error: err });
        user.pass = await auth.hashPassword(b.new);
        // encerra as outras sessões desta conta
        for (const k of Object.keys(db.sessions)) if (db.sessions[k].userId === user.id && k !== sess.key) delete db.sessions[k];
        save();
        return send(res, 200, { ok: true });
      }
      case 'POST /api/exclusives/equip': {
        if (!need()) return;
        const b = await readJson(req);
        await excl.equip(user.id, String(b.slot || ''), b.id == null ? null : String(b.id));
        return send(res, 200, { excl: excl.info(user.id) });
      }
      case 'GET /api/admin/whoami':
        if (!need()) return;
        return send(res, 200, { admin: ADMINS.has(user.username), username: user.username, nick: user.nick });
      case 'GET /api/admin/overview':
        if (!adminOnly()) return;
        return send(res, 200, { backend: excl.backend, status: excl.status, error: excl.error, catalog: excl.catalog() });
      case 'GET /api/admin/players': {
        if (!adminOnly()) return;
        /* Lista TODAS as contas (inclusive as de admin e a sua). Sem busca devolve todo mundo, em páginas. */
        const exact = (url.searchParams.get('u') || '').trim().toLowerCase();   // ?u=usuario → só essa conta
        if (exact) { const t = Object.values(db.users).find(x => x.username === exact); return send(res, 200, { total: t ? 1 : 0, offset: 0, admins: t && ADMINS.has(t.username) ? 1 : 0, players: t ? [adminPlayer(t)] : [] }); }
        const q = (url.searchParams.get('q') || '').trim().toLowerCase();
        const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit'), 10) || 20));
        const offset = Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0);
        const all = Object.values(db.users)
          .filter(u => !q || String(u.username).toLowerCase().includes(q) || String(u.nick || '').toLowerCase().includes(q))
          .sort((a, b) => String(a.nick || a.username).toLowerCase().localeCompare(String(b.nick || b.username).toLowerCase()) || (a.username < b.username ? -1 : 1));
        return send(res, 200, { total: all.length, offset, admins: all.filter(u => ADMINS.has(u.username)).length, players: all.slice(offset, offset + limit).map(adminPlayer) });
      }
      case 'POST /api/admin/grant':
      case 'POST /api/admin/revoke': {
        if (!adminOnly()) return;
        if (!auth.rateLimit('adm:' + user.id, 60, 60e3)) return send(res, 429, { error: 'Calma! Muitas ações seguidas.' });
        const b = await readJson(req);
        const target = Object.values(db.users).find(x => x.username === String(b.username || '').trim().toLowerCase());
        if (!target) return send(res, 404, { error: 'Jogador não encontrado.' });
        const item = String(b.item || '');
        const ids = item === '*' ? excl.catalog().map(i => i.id) : [item];   // '*' = todos os itens do catálogo
        for (const id of ids) {
          if (route === 'POST /api/admin/grant') await excl.grant(target.id, id, user.username, target.username);
          else if (item !== '*' || excl.has(target.id, id)) await excl.revoke(target.id, id, user.username, target.username);
        }
        return send(res, 200, { player: adminPlayer(target) });
      }
      case 'GET /api/admin/audit':
        if (!adminOnly()) return;
        return send(res, 200, { audit: await excl.audit(60) });
      case 'GET /api/rooms':
        return send(res, 200, { rooms: gs.list() });
      case 'GET /api/replays':
        if (!need()) return;
        return send(res, 200, { replays: replayStore.list(user.id) });
      case 'POST /api/rooms': {
        if (!auth.rateLimit('mkroom:' + (user ? user.id : ip(req)), 6, 600e3)) return send(res, 429, { error: 'Muitas salas criadas. Aguarde um pouco.' });
        const b = await readJson(req);
        const made = gs.createRoom({ name: b.name, password: b.pass, max: b.max, mapKey: b.map, style: b.style, scoreLimit: b.score, timeLimit: b.time,
          arbitration: b.arbitration === true, overtime: b.overtime, goldenGoal: b.goldenGoal !== false });
        if (made.error) return send(res, 503, { error: made.error });
        return send(res, 201, { room: made.room.info() });
      }
      case 'GET /api/net/metrics':           // só da própria máquina (ou FUTHUB_DEBUG=1)
        if (process.env.FUTHUB_DEBUG !== '1' && !/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress)) return send(res, 403, { error: 'Proibido.' });
        return send(res, 200, gs.metrics());
      case 'GET /api/modes':
        return send(res, 200, { modes: Object.entries(rk.MODES).map(([id, m]) => ({ id, label: m.label, group: m.group,
          requiredPlayers: m.requiredPlayers, teamSize: m.teamSize, timeLimit: m.rules.time, scoreLimit: m.rules.score })), tiers: rk.TIERS, start: rk.START });
      case 'POST /api/queue/join': {
        if (!need()) return;
        if (!auth.rateLimit('qj:' + user.id, 12, 60e3)) return send(res, 429, { error: 'Calma! Aguarde um instante para buscar outra partida.' });
        const b = await readJson(req);
        const r = mm.join(user, String(b.mode || ''));
        return send(res, r.error ? 400 : 200, r);
      }
      case 'GET /api/queue/status':
        if (!need()) return;
        return send(res, 200, mm.status(user));
      case 'POST /api/queue/leave':
        if (!need()) return;
        return send(res, 200, mm.leave(user));
      case 'POST /api/queue/accept': {
        if (!need()) return;
        const r = mm.accept(user);
        return send(res, r.error ? (r.status || 400) : 200, r);
      }
      case 'POST /api/ranked/finish': {
        if (!need()) return;
        const b = await readJson(req);
        const r = rk.finishMatch(user, b);
        return send(res, r.error ? (r.status || 400) : 200, r);
      }
      case 'GET /api/ranking': {
        const mode = url.searchParams.get('mode') || 'v3';
        const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit'), 10) || 50));
        const r = rk.ranking(mode, user, limit);
        return send(res, r.error ? 400 : 200, r);
      }
      default:
        return send(res, 404, { error: 'Rota não encontrada.' });
    }
  } catch (e) {
    if (e && e.status) return send(res, e.status, { error: e.error });
    console.error(e);
    return send(res, 500, { error: 'Erro interno.' });
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { res.writeHead(400); return res.end(); }
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  const f = path.join(root, path.normalize(p));
  if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});
/* Novidades da versão atual: aparecem no terminal quando o servidor inicia. */
const CHANGELOG = [
  'Painel de admin (/admin.html) para dar itens exclusivos aos jogadores, com MySQL (veja docs/MYSQL.md).',
  'Exclusivos: uniforme ZK Gold e efeito de explosão ao fazer gol.',
  'Tela inicial: borda do personagem (e do avatar do perfil) agora é preta.',
  'Áudio: nova barra de Volume geral (configurações e painel da partida) que abaixa todos os sons.',
  'Áudio: volumes separados para som da bola, torcida e som de gol (apito), em Configurações e no painel da partida.',
  'Áudio: presets de som da bola (Chute seco, Chute grave, Estalo, Bola de praia, Quicar, Retrô 8-bit, Bolha).'
];
server.on('upgrade', (req, socket, head) => gs.upgrade(req, socket, head));
server.listen(port, () => {
  const v = require('./package.json').version;
  console.log('ZunkoBall rodando em http://localhost:' + port);
  console.log('Exclusivos: ' + excl.backend.toUpperCase() + ' | admins: ' + (ADMINS.size ? [...ADMINS].join(', ') : '(nenhum — defina ZUNKO_ADMINS)'));
  console.log('\nVersão ' + v + ' — atualizações:');
  for (const line of CHANGELOG) console.log('  + ' + line);
  console.log('');
});
