'use strict';
/* Efeitos de gol: roda cada efeito por ~3 s com um canvas falso e confere que desenha sem erro, termina e é determinístico. */
const fs = require('fs'), path = require('path'), vm = require('vm');
let fail = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fail++; };

function fakeCtx() {
  const calls = { n: 0, nan: 0 };
  const grad = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === '__calls') return calls;
      if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => grad;
      if (k in t) return t[k];
      return (...a) => { calls.n++; for (const v of a) if (typeof v === 'number' && !isFinite(v)) calls.nan++; };
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  return ctx;
}
const win = {}; vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'game', 'goalfx.js'), 'utf8'), { window: win, Math, Object, Date });
const FX = win.FH_GOALFX;
const catalog = require('../server/exclusives.js').CATALOG.filter(i => i.kind === 'fx').map(i => i.id);

ok(catalog.length >= 8, 'catálogo tem ' + catalog.length + ' efeitos de gol');
for (const id of catalog) ok(FX.has(id), id + ': existe em goalfx.js (catálogo e desenho estão alinhados)');
ok(!FX.has('x-nao-existe'), 'efeito desconhecido não desenha');

for (const id of FX.ids()) {
  const c = fakeCtx(), g = { fx: id, t: 0, seed: 7 }, ball = { x: 100, y: 60 };
  let err = null, started = 0; FX.onStart = () => started++;
  try { for (let t = 0; t <= 2.4; t += 1 / 60) { g.t = t; FX.drawWorld(c, g, ball, 5); FX.drawScreen(c, g, 800, 400); } } catch (e) { err = e; }
  ok(!err, id + ': anima 2,4 s sem erro' + (err ? ' (' + err.message + ')' : ''));
  ok(c.__calls.n > 200, id + ': desenha de verdade (' + c.__calls.n + ' chamadas)');
  ok(c.__calls.nan === 0, id + ': nenhum valor inválido (NaN/Infinity) nas coordenadas');
  ok(started === 1, id + ': dispara o som uma única vez');
  // depois do fim (2,6 s) não sobra nada visível
  const late = fakeCtx(); g.t = 2.6; FX.drawWorld(late, g, ball, 5);
  ok(late.__calls.n < 20, id + ': fim limpo (nada de partículas penduradas)');
}
// pré-visualização
const pc = fakeCtx(); let perr = null;
try { for (let ts = 0; ts < 7000; ts += 16) FX.preview(pc, 600, 300, 'x-fogos', ts); } catch (e) { perr = e; }
ok(!perr && pc.__calls.n > 500, 'pré-visualização roda em loop (reinicia a cada ciclo)');
process.exit(fail ? 1 : 0);
