'use strict';
/* Itens exclusivos (uniformes e efeitos de gol) dados pelo painel de admin.
   - As CONTAS continuam no db.json; só os exclusivos (concessões, itens equipados e auditoria) ficam no MySQL.
   - Leituras são síncronas (cache em memória, usadas durante a partida); gravações vão ao MySQL primeiro e só
     depois atualizam o cache, então o cache nunca mostra algo que não foi salvo.
   - Sem MYSQL_URL/MYSQL_HOST configurado, usa o arquivo db.json (modo de desenvolvimento/teste). */

const SLOTS = ['kit', 'fx'];
const CATALOG = [
  /* ---- uniformes ---- */
  { id: 'x-zk-gold',    kind: 'kit', rarity: 'legendary', name: 'ZK Gold',     desc: 'Uniforme exclusivo preto com raios dourados.' },
  { id: 'x-zk-neon',    kind: 'kit', rarity: 'epic',      name: 'ZK Neon',     desc: 'Preto com faixas ciano que brilham no escuro.' },
  { id: 'x-zk-fire',    kind: 'kit', rarity: 'epic',      name: 'ZK Fogo',     desc: 'Degradê de chamas, do vermelho-brasa ao amarelo.' },
  { id: 'x-zk-galaxy',  kind: 'kit', rarity: 'epic',      name: 'ZK Galáxia',  desc: 'Roxo profundo salpicado de estrelas.' },
  { id: 'x-zk-ice',     kind: 'kit', rarity: 'rare',      name: 'ZK Gelo',     desc: 'Degradê azul-gelo, frio e brilhante.' },
  { id: 'x-zk-royal',   kind: 'kit', rarity: 'legendary', name: 'ZK Real',     desc: 'Roxo real com metade dourada.' },
  { id: 'x-zk-toxic',   kind: 'kit', rarity: 'rare',      name: 'ZK Tóxico',   desc: 'Preto com raios verde-limão radioativos.' },
  { id: 'x-zk-sakura',  kind: 'kit', rarity: 'rare',      name: 'ZK Sakura',   desc: 'Rosa-claro com flores de cerejeira.' },
  { id: 'x-zk-diamond', kind: 'kit', rarity: 'epic',      name: 'ZK Diamante', desc: 'Xadrez azul-diamante sobre fundo noturno.' },
  { id: 'x-zk-carbon',  kind: 'kit', rarity: 'rare',      name: 'ZK Carbono',  desc: 'Fibra de carbono com faixa prateada.' },
  /* ---- efeitos de gol ---- */
  { id: 'x-explosao', kind: 'fx', rarity: 'legendary', name: 'Explosão',        desc: 'Explosão de fogo no lugar do gol quando você marca.' },
  { id: 'x-confete',  kind: 'fx', rarity: 'rare',      name: 'Confete',         desc: 'Chuva de confete colorido pelo campo.' },
  { id: 'x-fogos',    kind: 'fx', rarity: 'epic',      name: 'Fogos de artifício', desc: 'Várias salvas de fogos coloridos estourando.' },
  { id: 'x-raio',     kind: 'fx', rarity: 'epic',      name: 'Raio',            desc: 'Relâmpagos saem do gol e a tela pisca.' },
  { id: 'x-moedas',   kind: 'fx', rarity: 'rare',      name: 'Chuva de moedas', desc: 'Moedas de ouro giratórias voam pelo campo.' },
  { id: 'x-coracoes', kind: 'fx', rarity: 'rare',      name: 'Corações',        desc: 'Corações flutuam a partir do gol.' },
  { id: 'x-gelo',     kind: 'fx', rarity: 'epic',      name: 'Cristais de gelo', desc: 'Onda congelante com estilhaços de gelo.' },
  { id: 'x-vortice',  kind: 'fx', rarity: 'legendary', name: 'Vórtice',         desc: 'Espiral de energia neon girando para fora.' }
];
const byId = new Map(CATALOG.map(i => [i.id, i]));

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS exclusive_grants (
     user_id    CHAR(16)    NOT NULL,
     item_id    VARCHAR(48) NOT NULL,
     granted_by VARCHAR(32) NOT NULL,
     granted_at BIGINT      NOT NULL,
     PRIMARY KEY (user_id, item_id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS exclusive_equipped (
     user_id CHAR(16)    NOT NULL,
     slot    VARCHAR(8)  NOT NULL,
     item_id VARCHAR(48) NOT NULL,
     PRIMARY KEY (user_id, slot)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE IF NOT EXISTS exclusive_audit (
     id      BIGINT AUTO_INCREMENT PRIMARY KEY,
     at      BIGINT      NOT NULL,
     admin   VARCHAR(32) NOT NULL,
     action  VARCHAR(16) NOT NULL,
     target  VARCHAR(32) NOT NULL,
     item_id VARCHAR(48) NOT NULL,
     KEY idx_at (at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

/* ---------- armazenamento em arquivo (fallback sem MySQL) ---------- */
class JsonStore {
  constructor(db, save) {
    this.name = 'json'; this.db = db; this.save = save;
    if (!db.exclusives) db.exclusives = { grants: [], equipped: [], audit: [] };
  }
  async init() {}
  async loadAll() { const x = this.db.exclusives; return { grants: x.grants.slice(), equipped: x.equipped.slice() }; }
  async addGrant(g) {
    const x = this.db.exclusives;
    if (!x.grants.some(r => r.uid === g.uid && r.item === g.item)) x.grants.push({ uid: g.uid, item: g.item, by: g.by, at: g.at });
    this.save();
  }
  async removeGrant(uid, item) { const x = this.db.exclusives; x.grants = x.grants.filter(r => !(r.uid === uid && r.item === item)); this.save(); }
  async setEquipped(uid, slot, item) {
    const x = this.db.exclusives; x.equipped = x.equipped.filter(r => !(r.uid === uid && r.slot === slot));
    if (item) x.equipped.push({ uid, slot, item });
    this.save();
  }
  async addAudit(a) { const x = this.db.exclusives; x.audit.push(a); if (x.audit.length > 500) x.audit.splice(0, x.audit.length - 500); this.save(); }
  async listAudit(limit) { return this.db.exclusives.audit.slice(-limit).reverse(); }
}

/* ---------- MySQL ---------- */
class MysqlStore {
  constructor(pool) { this.name = 'mysql'; this.pool = pool; }
  async init() { for (const sql of SCHEMA) await this.pool.query(sql); }
  async loadAll() {
    const [g] = await this.pool.query('SELECT user_id AS uid, item_id AS item, granted_by AS `by`, granted_at AS `at` FROM exclusive_grants');
    const [e] = await this.pool.query('SELECT user_id AS uid, slot, item_id AS item FROM exclusive_equipped');
    return { grants: g, equipped: e };
  }
  async addGrant(g) {
    await this.pool.query('INSERT IGNORE INTO exclusive_grants (user_id, item_id, granted_by, granted_at) VALUES (?, ?, ?, ?)', [g.uid, g.item, g.by, g.at]);
  }
  async removeGrant(uid, item) { await this.pool.query('DELETE FROM exclusive_grants WHERE user_id = ? AND item_id = ?', [uid, item]); }
  async setEquipped(uid, slot, item) {
    if (item) await this.pool.query('INSERT INTO exclusive_equipped (user_id, slot, item_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE item_id = VALUES(item_id)', [uid, slot, item]);
    else await this.pool.query('DELETE FROM exclusive_equipped WHERE user_id = ? AND slot = ?', [uid, slot]);
  }
  async addAudit(a) {
    await this.pool.query('INSERT INTO exclusive_audit (at, admin, action, target, item_id) VALUES (?, ?, ?, ?, ?)', [a.at, a.admin, a.action, a.target, a.item]);
  }
  async listAudit(limit) {
    const [r] = await this.pool.query('SELECT at, admin, action, target, item_id AS item FROM exclusive_audit ORDER BY id DESC LIMIT ?', [limit]);
    return r;
  }
}

const fail = (status, error) => Object.assign(new Error(error), { status, error });

class Exclusives {
  /* opts: { db, save, env, log, mysql } — `mysql` só é passado em testes (substitui require('mysql2/promise')) */
  constructor(opts) {
    this.opts = opts; this.log = opts.log || console.log;
    this.grants = new Map();      // uid -> Map(item -> { by, at })
    this.equipped = new Map();    // uid -> { kit, fx }
    this.store = null; this.status = 'starting'; this.error = '';
    const env = opts.env || {};
    this.useMysql = !!(env.MYSQL_URL || env.MYSQL_HOST);
    this.retryTimer = null;
  }
  get backend() { return this.useMysql ? 'mysql' : 'json'; }

  async start() {
    if (!this.useMysql) {
      this.store = new JsonStore(this.opts.db, this.opts.save);
      await this._load();
      return;
    }
    await this._connectMysql();
  }
  async _connectMysql() {
    const env = this.opts.env;
    try {
      let mysql = this.opts.mysql;
      if (!mysql) {
        try { mysql = require('mysql2/promise'); } catch (e) { throw new Error('pacote mysql2 não instalado (rode: npm install)'); }
      }
      const pool = env.MYSQL_URL ? mysql.createPool(env.MYSQL_URL)
        : mysql.createPool({ host: env.MYSQL_HOST, port: +env.MYSQL_PORT || 3306, user: env.MYSQL_USER, password: env.MYSQL_PASSWORD,
          database: env.MYSQL_DATABASE || 'zunkoball', waitForConnections: true, connectionLimit: 5, charset: 'utf8mb4' });
      const store = new MysqlStore(pool);
      await store.init();
      this.store = store;
      await this._load();
      this.log('[exclusivos] MySQL conectado.');
    } catch (e) {
      this.status = 'offline'; this.error = e.message;
      this.log('[exclusivos] MySQL indisponível: ' + e.message + ' — nova tentativa em 30s. O jogo segue funcionando sem exclusivos.');
      clearTimeout(this.retryTimer);
      this.retryTimer = setTimeout(() => this._connectMysql(), 30e3);
      if (this.retryTimer.unref) this.retryTimer.unref();
    }
  }
  async _load() {
    const { grants, equipped } = await this.store.loadAll();
    this.grants = new Map(); this.equipped = new Map();
    for (const g of grants) {
      if (!byId.has(g.item)) continue;
      if (!this.grants.has(g.uid)) this.grants.set(g.uid, new Map());
      this.grants.get(g.uid).set(g.item, { by: g.by, at: Number(g.at) });
    }
    for (const r of equipped) {
      if (!SLOTS.includes(r.slot) || !this.has(r.uid, r.item)) continue;
      const cur = this.equipped.get(r.uid) || { kit: null, fx: null };
      cur[r.slot] = r.item; this.equipped.set(r.uid, cur);
    }
    this.status = 'ready'; this.error = '';
  }
  _writable() { if (this.status !== 'ready') throw fail(503, 'Exclusivos indisponíveis no momento (banco MySQL fora do ar).'); }

  catalog() { return CATALOG.map(i => Object.assign({}, i)); }
  item(id) { return byId.get(id) || null; }
  has(uid, item) { const m = this.grants.get(uid); return !!(m && m.has(item)); }
  ownedIds(uid) { const m = this.grants.get(uid); return m ? [...m.keys()] : []; }
  /* usado durante a partida (síncrono): o que este jogador tem equipado */
  equippedOf(uid) { const e = this.equipped.get(uid); return { kit: (e && e.kit) || null, fx: (e && e.fx) || null }; }
  /* enviado ao próprio jogador (/api/me) */
  info(uid) {
    return { items: this.ownedIds(uid).map(id => byId.get(id)).filter(Boolean).map(i => Object.assign({}, i)), equipped: this.equippedOf(uid) };
  }

  async grant(uid, item, admin, targetName) {
    if (!byId.has(item)) throw fail(400, 'Item inexistente.');
    this._writable();
    if (this.has(uid, item)) return;          // já tem: nada a gravar nem a auditar
    const rec = { uid, item, by: admin, at: Date.now() };
    await this.store.addGrant(rec);
    if (!this.grants.has(uid)) this.grants.set(uid, new Map());
    if (!this.grants.get(uid).has(item)) this.grants.get(uid).set(item, { by: admin, at: rec.at });
    await this.store.addAudit({ at: rec.at, admin, action: 'grant', target: targetName, item });
  }
  async revoke(uid, item, admin, targetName) {
    if (!byId.has(item)) throw fail(400, 'Item inexistente.');
    this._writable();
    await this.store.removeGrant(uid, item);
    const eq = this.equipped.get(uid), slot = byId.get(item).kind;
    if (eq && eq[slot] === item) { await this.store.setEquipped(uid, slot, null); eq[slot] = null; }
    const m = this.grants.get(uid); if (m) m.delete(item);
    await this.store.addAudit({ at: Date.now(), admin, action: 'revoke', target: targetName, item });
  }
  async equip(uid, slot, item) {
    if (!SLOTS.includes(slot)) throw fail(400, 'Espaço inválido.');
    if (item != null) {
      const it = byId.get(item);
      if (!it || it.kind !== slot) throw fail(400, 'Item inválido para este espaço.');
      if (!this.has(uid, item)) throw fail(403, 'Você não possui este item.');
    }
    this._writable();
    await this.store.setEquipped(uid, slot, item || null);
    const cur = this.equipped.get(uid) || { kit: null, fx: null };
    cur[slot] = item || null; this.equipped.set(uid, cur);
  }
  async audit(limit) { if (this.status !== 'ready') return []; return this.store.listAudit(Math.max(1, Math.min(200, limit || 50))); }
}

module.exports = { Exclusives, CATALOG, SLOTS, SCHEMA, JsonStore, MysqlStore };
