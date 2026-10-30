'use strict';
/* Teste da tela Replays (abas, filtros, ordenação, mensagens) e da barra do player, rodando game/replay.js
   num DOM mínimo falso (sem navegador). Rodar: node test/replay-ui.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0, n = 0; const ok = (c, m) => { n++; if (!c) { fail++; console.log('FAIL ' + m); } else console.log('PASS ' + m); };

function el(tag) {
  const e = { tag, children: [], className: '', value: '', _text: '', attrs: {}, style: { setProperty() {} }, handlers: {}, id: '', hidden: false,
    classList: { _s: new Set(), toggle(c, on) { (on === undefined ? !this._s.has(c) : on) ? this._s.add(c) : this._s.delete(c); }, add(c) { this._s.add(c); }, remove(...c) { c.forEach(x => this._s.delete(x)); }, contains(c) { return this._s.has(c); } },
    appendChild(c) { this.children.push(c); return c; }, append(...c) { c.forEach(x => this.children.push(x)); }, replaceChildren() { this.children = []; },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, addEventListener(t, f) { this.handlers[t] = f; },
    querySelector() { return null; }, querySelectorAll() { return []; }, set textContent(v) { this._text = v; this.children = []; }, get textContent() { return this._text; } };
  return e;
}
const ids = {}; ['replaysList', 'rpQ', 'rpPlayer', 'rpMode', 'rpDate', 'rpSort', 'rpTabAcc', 'rpTabDev', 'replaysBack', 'replaysImport', 'replaysFile', 'homeReplays'].forEach(i => { ids[i] = el(i === 'rpQ' || i === 'rpPlayer' ? 'input' : 'div'); ids[i].id = i; });
const doc = { readyState: 'complete', getElementById: i => ids[i] || null, createElement: el, addEventListener() {}, body: el('body') };
const now = Date.now(), D = 864e5;
const mk = (id, map, red, blue, fr, fb, age, dur, src, players) => ({ id, source: src, map, mode: 'online', ranked: false, teams: { red, blue }, finalScore: { red: fr, blue: fb }, createdAt: now - age * D, durationSec: dur, players });
const BIG = []; for (let i = 0; i < 11; i++) { BIG.push({ nick: 'R' + i, avatar: 'R' + i, team: 'red' }); BIG.push({ nick: 'B' + i, avatar: 'B' + i, team: 'blue' }); }
const ONLINE = [mk('a', 'v3', ['Ana'], ['Bia'], 2, 1, 0.1, 120, undefined, [{ nick: 'Ana', avatar: 'AN', team: 'red' }, { nick: 'Bia', avatar: 'BI', team: 'blue' }]),
  mk('b', 'v1', ['Zé'], ['Léo'], 5, 4, 3, 300), mk('c', 'r5', ['Ana'], ['Caio'], 0, 0, 40, 60), mk('e', 'r11', ['x'], ['y'], 3, 3, 2, 600, undefined, BIG)];
const LOCAL = [mk('d', 'v3', ['Voce'], ['IA'], 1, 0, 1, 90, 'local')];
let loggedIn = true;
const ctx = { window: {}, document: doc, console, setTimeout, clearTimeout, performance, Date, JSON, Math, requestAnimationFrame() {},
  fetch: () => Promise.resolve(loggedIn ? { status: 200, ok: true, json: () => Promise.resolve({ replays: ONLINE }) } : { status: 401, ok: false, json: () => Promise.resolve({ error: 'login' }) }),
  localStorage: { getItem() { return null; }, setItem() {} }, indexedDB: undefined, navigator: {}, location: {}, MAPS: {}, show() {}, FH_STATS: null };
ctx.window = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'game', 'replay.js'), 'utf8'), ctx);
ctx.FH_LIB.list = () => Promise.resolve(LOCAL.slice());
const tick = () => new Promise(r => setTimeout(r, 15));
const names = () => ids.replaysList.children.map(c => c.children && c.children[0] ? 1 : 0).length;
const texts = () => ids.replaysList.children.map(c => (c.className || '') + '|' + JSON.stringify(c.children.map(x => x._text)));
const scoreOf = c => c.children[1].children[1]._text;     // "2 – 1"
(async () => {
  ctx.FH_REPLAYS.refresh(); await tick();
  ok(ids.replaysList.children.length === 4, 'aba "Minha conta" lista as 4 partidas online');
  ok(scoreOf(ids.replaysList.children[0]) === '2 – 1', 'ordenação padrão: mais recente primeiro');
  ok(ids.rpMode.children.length === 5, 'filtro de modalidade montado a partir dos replays (4 + "Todas")');

  const cards = ids.replaysList.children.slice(), vsOf = c => c.children[1], stack = (c, i) => vsOf(c).children[i === 0 ? 0 : 2], disks = st => st.children[0].children;
  const byScore = sc => cards.find(c => scoreOf(c) === sc);
  const cA = byScore('2 – 1'), cOld = byScore('5 – 4'), cBig = byScore('3 – 3');
  ok(disks(stack(cA, 0)).length === 1 && disks(stack(cA, 0))[0]._text === 'AN' && disks(stack(cA, 1))[0]._text === 'BI', 'vermelho mostra o boneco do jogador (AN) e azul o do oponente (BI)');
  ok(/rpAvR/.test(disks(stack(cA, 0))[0].className) && /rpAvB/.test(disks(stack(cA, 1))[0].className), 'bonecos usam as classes de time rpAvR / rpAvB');
  const all = []; const walk = e => { all.push(e.className || ''); (e.children || []).forEach(walk); }; cards.forEach(walk);
  ok(!all.some(c => /(^|\s)(red|blue)(\s|$)/.test(c)), 'nenhum elemento do card usa as classes globais .red/.blue (causa da elipse vermelha)');
  ok(stack(cA, 0).children.length === 2 && stack(cA, 0).children[1]._text === 'Ana', '1x1: nome aparece ao lado do boneco');
  ok(disks(stack(cOld, 0))[0]._text === 'ZÉ' && disks(stack(cOld, 1))[0]._text === 'LÉ', 'replay antigo (sem players): boneco com iniciais do nome');
  ok(disks(stack(cBig, 0)).length === 6 && disks(stack(cBig, 0))[5]._text === '+6' && disks(stack(cBig, 1)).length === 6, '11x11: 5 bonecos por time + "+6" (cabe na linha)');
  ok(stack(cBig, 0).children.length === 1, 'time grande não mostra nome (só bonecos)');

  ids.rpPlayer.value = 'ana'; ids.rpPlayer.handlers.input(); ok(ids.replaysList.children.length === 2, 'filtro Jogador "ana" -> 2 partidas');
  ids.rpMode.value = 'r5'; ids.rpMode.handlers.change(); ok(ids.replaysList.children.length === 1, 'Jogador + Modalidade Real 5v5 -> 1 partida');
  ids.rpPlayer.value = ''; ids.rpPlayer.handlers.input(); ids.rpMode.value = ''; ids.rpMode.handlers.change();
  ids.rpDate.value = '7'; ids.rpDate.handlers.change(); ok(ids.replaysList.children.length === 3, 'Data "últimos 7 dias" esconde a de 40 dias');
  ids.rpDate.value = ''; ids.rpSort.value = 'old'; ids.rpSort.handlers.change(); ok(scoreOf(ids.replaysList.children[0]) === '0 – 0', 'ordenar "mais antigos" põe a de 40 dias primeiro');
  ids.rpSort.value = 'goals'; ids.rpSort.handlers.change(); ok(scoreOf(ids.replaysList.children[0]) === '5 – 4', 'ordenar "mais gols" põe 5x4 primeiro');
  ids.rpSort.value = 'new'; ids.rpQ.value = 'futsal 1v1'; ids.rpQ.handlers.input(); ok(ids.replaysList.children.length === 1, 'busca por texto usa o nome da modalidade ("Futsal 1v1")');
  ids.rpQ.value = 'zzz'; ids.rpQ.handlers.input(); ok(ids.replaysList.children.length === 1 && /Nenhum replay encontrado/.test(ids.replaysList.children[0]._text), 'sem resultado mostra mensagem de filtros');
  ids.rpQ.value = ''; ids.rpQ.handlers.input();

  ids.rpTabDev.onclick(); await tick();
  ok(ids.replaysList.children.length === 1 && ids.rpTabDev.classList.contains('on') && !ids.rpTabAcc.classList.contains('on'), 'aba "Neste dispositivo" mostra só os replays locais');

  loggedIn = false; ids.rpTabAcc.onclick(); await tick();
  ok(ids.replaysList.children.length === 1 && /Entre com sua conta/.test(ids.replaysList.children[0]._text), 'sem login: mensagem "Entre com sua conta…" (como no layout)');
  console.log(fail ? '\nFALHOU ' + fail : '\nTODOS OS ' + n + ' TESTES DE UI DO REPLAY PASSARAM'); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
