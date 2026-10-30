'use strict';
/* Lê o arquivo .env da pasta do projeto (CHAVE=valor, uma por linha, # para comentário).
   Variáveis já definidas no sistema têm prioridade e não são sobrescritas. Sem dependências. */
const fs = require('fs'), path = require('path');
try {
  const txt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line[0] === '#') continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (/^(".*"|'.*')$/.test(val)) val = val.slice(1, -1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && process.env[key] === undefined) process.env[key] = val;
  }
} catch (e) { /* sem .env: tudo certo */ }
