'use strict';
const crypto = require('crypto');
const { db, save } = require('./db');

const SESSION_DAYS = 30;
const USER_RE = /^[a-z0-9_]{3,16}$/;

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const scrypt = (pw, salt) => new Promise((res, rej) =>
  crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => e ? rej(e) : res(k)));

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return salt.toString('hex') + ':' + key.toString('hex');
}
async function checkPassword(pw, stored) {
  const [saltHex, keyHex] = String(stored).split(':');
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, 'hex'));
  const a = Buffer.from(keyHex, 'hex');
  return a.length === key.length && crypto.timingSafeEqual(a, key);
}

function cleanNick(v, fallback) {
  const s = Array.from(String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim()).slice(0, 16).join('');
  return s || fallback;
}
function cleanAvatar(v) {
  return Array.from(String(v == null ? '' : v).replace(/[\u0000-\u001f<>\s]/g, '')).slice(0, 2).join('') || 'P1';
}

function validateCredentials(username, password) {
  if (!USER_RE.test(username)) return 'Usuário: 3 a 16 caracteres (letras minúsculas, números e _).';
  if (typeof password !== 'string' || password.length < 6 || password.length > 72) return 'A senha deve ter de 6 a 72 caracteres.';
  return null;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[sha(token)] = { userId, expires: Date.now() + SESSION_DAYS * 864e5 };
  save();
  return token;
}
function getSession(token) {
  if (!token) return null;
  const key = sha(token), s = db.sessions[key];
  if (!s) return null;
  if (s.expires < Date.now()) { delete db.sessions[key]; save(); return null; }
  return db.users[s.userId] ? { key, user: db.users[s.userId] } : null;
}
function destroySession(token) {
  if (token && db.sessions[sha(token)]) { delete db.sessions[sha(token)]; save(); }
}
setInterval(() => {   // limpa sessões vencidas
  const now = Date.now(); let n = 0;
  for (const k of Object.keys(db.sessions)) if (db.sessions[k].expires < now) { delete db.sessions[k]; n++; }
  if (n) save();
}, 3600e3).unref();

/* limitador simples em memória: máx. N tentativas por janela */
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr);
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

module.exports = { USER_RE, hashPassword, checkPassword, validateCredentials, cleanNick, cleanAvatar,
  createSession, getSession, destroySession, rateLimit };
