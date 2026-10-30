'use strict';
/* Banco de dados em arquivo JSON (sem dependências).
   Tudo fica em memória e é gravado em disco de forma atômica (arquivo temporário + rename),
   com debounce para não gravar a cada requisição. Para milhares de jogadores simultâneos,
   troque por SQLite/Postgres mantendo a mesma interface (users, sessions, matches). */
const fs = require('fs');
const path = require('path');

const DIR = process.env.FUTHUB_DATA || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'db.json');

let db = { users: {}, sessions: {}, openMatches: {}, history: [] };
try {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) db = Object.assign(db, JSON.parse(fs.readFileSync(FILE, 'utf8')));
} catch (e) {
  console.error('Falha ao ler o banco, iniciando vazio:', e.message);
}

let timer = null, writing = false, dirty = false;
function flush() {
  if (writing) { dirty = true; return; }
  writing = true; dirty = false;
  const tmp = FILE + '.tmp';
  fs.writeFile(tmp, JSON.stringify(db), err => {
    if (err) { writing = false; console.error('Erro ao gravar banco:', err.message); return; }
    fs.rename(tmp, FILE, err2 => {
      writing = false;
      if (err2) console.error('Erro ao gravar banco:', err2.message);
      if (dirty) flush();
    });
  });
}
function save() { clearTimeout(timer); timer = setTimeout(flush, 300); }
function flushSync() {
  try { fs.writeFileSync(FILE + '.tmp', JSON.stringify(db)); fs.renameSync(FILE + '.tmp', FILE); } catch (e) {}
}
process.on('SIGINT', () => { flushSync(); process.exit(0); });
process.on('SIGTERM', () => { flushSync(); process.exit(0); });

module.exports = { db, save };
