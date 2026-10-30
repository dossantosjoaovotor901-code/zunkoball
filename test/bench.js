'use strict';
/* Benchmarks do multiplayer em tempo virtual (determinísticos). Rodar: node test/bench.js [--json arquivo]
 * Compara, no MESMO cenário de rede:
 *   SEM PREDIÇÃO  = cliente que só desenha os snapshots do servidor interpolados (como seria um cliente "ingênuo")
 *   COM PREDIÇÃO  = cliente final do FutHub (predição + reconciliação + suavização)
 * Nenhum número é inventado: tudo vem das classes reais (Room + FHNet.Client) sobre o link simulado (test/netsim.js). */
const { NetSim, pct, avg } = require('./netsim.js');
const fs = require('fs');

const P = {
  baixo:   { oneWay: 10,  jitter: 2,  loss: 0 },       // ~20 ms de ping
  medio:   { oneWay: 40,  jitter: 8,  loss: 0 },       // ~80 ms
  alto:    { oneWay: 120, jitter: 25, loss: 0 },       // ~240 ms
  pico:    { oneWay: 40,  jitter: 8,  loss: 0, spikes: [{ from: 1000 + 12000, to: 1000 + 13500, extra: 400 }] },   // +400 ms por 1,5 s
  perda5:  { oneWay: 40,  jitter: 8,  loss: 0.05 },    // 5% de perda (retransmissão TCP + bloqueio de fila)
};

function run(name, o, predict) {
  const ns = new NetSim({ map: o.map || 'v1', seed: 11, style: o.style });
  const errs = [], corrs = [], adiv = [], srv = new Map();
  const nClients = o.clients || 2;
  const cs = [];
  for (let i = 0; i < nClients; i++) {
    const profile = (o.profiles && o.profiles[i % o.profiles.length]) || o.profile;
    const c = ns.addClient({ profile, fps: (o.fps && o.fps[i]) || 60, frameJitter: o.frameJitter, predict, team: o.teams ? o.teams[i] : undefined,
      behavior: (i === 0 && o.probe) ? 'probe' : 'bot' });
    if (predict) { const orig = c.net._reconcile.bind(c.net); c.net._reconcile = function (m) { orig(m); if (ns.t > 5000) { errs.push(c.net.st.err); corrs.push(c.net.st.corr); } }; }
    cs.push(c);
  }
  if (global.gc) global.gc();
  const rt = ns.room.tick.bind(ns.room);       // guarda a verdade do servidor por tick (para comparar com o que cada cliente decodificou)
  ns.room.tick = function () { rt(); const s = this.world.s; srv.set(s.tick, [s.ball.x, s.ball.y, ...s.players.map(p => p.x), ...s.players.map(p => p.y)]); srv.delete(s.tick - 300); };
  const mem0 = process.memoryUsage();
  ns.room.start();
  const dur = o.duration || (o.probe ? 60000 : 30000), step = 100;
  let sample = 0;
  for (let t = 0; t < dur; t += step) {
    if (o.onTime) o.onTime(ns, t, cs);
    ns.run(step);
    if (t > 6000) for (const c of cs) {                 // estado autoritativo decodificado pelo cliente x verdade do servidor no MESMO tick
      if (!c.connected || !c.net.auth || !c.net.hasBase) continue;
      const v = srv.get(c.net.auth.tick); if (!v) continue;
      adiv.push(Math.hypot(c.net.auth.ball.x - v[0], c.net.auth.ball.y - v[1]));
    }
  }
  if (global.gc) global.gc();
  const mem1 = process.memoryUsage(), r = ns.room, s = r.world.s;
  const probe = cs[0].probe ? cs[0].probe.done : [];
  const live = cs.filter(c => c.connected);
  const res = {
    cenario: name, predicao: predict, clientes: nClients,
    latencia_input_ms: o.probe ? { media: +avg(probe).toFixed(0), p95: pct(probe, .95), n: probe.length, descartadas: cs[0].probe ? cs[0].probe.blocked : 0 } : null,
    erro_predicao_m: predict ? { media: +avg(errs).toFixed(3), p95: +pct(errs, .95).toFixed(3), max: +Math.max(0, ...errs).toFixed(3) } : null,
    correcao_suavizada_m: predict ? { p95: +pct(corrs, .95).toFixed(3), max: +Math.max(0, ...corrs).toFixed(3) } : null,
    divergencia_autoritativa_m: { max: +Math.max(0, ...adiv).toFixed(6), amostras: adiv.length },
    snapshots_por_s: +avg(live.map(c => c.net.st.snapHz)).toFixed(1),
    kib_s_por_cliente: +avg(live.map(c => c.net.st.bps / 1024)).toFixed(2),
    lacunas_snapshot: live.reduce((a, c) => a + c.net.st.gaps, 0),
    entradas_repetidas_starved: r.m.starved, entradas_descartadas_trim: r.m.trimmed,
    fila_servidor_media: +avg(live.map(c => c.net.st.qlen)).toFixed(1),
    tick_servidor_us: { media: +avg(ns.samples.tickUs).toFixed(0), p99: +pct(ns.samples.tickUs, .99).toFixed(0), max: +Math.max(...ns.samples.tickUs).toFixed(0) },
    placar_servidor: s.red + 'x' + s.blue, placar_ok: live.every(c => c.net.auth && c.net.auth.red === s.red && c.net.auth.blue === s.blue || Math.abs(c.net.auth.tick - s.tick) < 4),
    heap_delta_MB: +((mem1.heapUsed - mem0.heapUsed) / 1048576).toFixed(1)
  };
  if (o.after) res.extra = o.after(ns, cs);
  ns.close();
  return res;
}

const scenarios = [
  ['rede baixa (ping ~20 ms)',            { profile: P.baixo, probe: true }],
  ['rede média (ping ~80 ms)',            { profile: P.medio, probe: true }],
  ['rede alta (ping ~240 ms)',            { profile: P.alto, probe: true }],
  ['pico de latência (+400 ms por 1,5 s)', { profile: P.pico, probe: true }],
  ['perda de pacotes 5 %',                { profile: P.perda5, probe: true }],
  ['cliente com FPS baixo (20 FPS, jitter de quadro)', { profile: P.medio, probe: true, fps: [20, 60], frameJitter: 30 }],
  ['disputa de bola, rede ruim (1x1, ping 240 ms vs 40 ms, perda 5 %)', { profiles: [{ oneWay: 120, jitter: 25, loss: .05 }, { oneWay: 20, jitter: 5, loss: 0 }], duration: 40000 }],
  ['20 jogadores (10x10) no campo 3v3, ping 80 ms', { map: 'v3', clients: 20, profile: P.medio, duration: 20000 }],
  ['22 jogadores (11x11) Real Soccer, redes mistas', { map: 'r11', style: 'real', clients: 22, profiles: [P.baixo, P.medio, P.alto, P.perda5], duration: 20000 }],
];
const out = [];
for (const [name, o] of scenarios) {
  for (const predict of [false, true]) { const r = run(name, o, predict); out.push(r); }
}

/* cenários de estabilidade (só com predição) */
const stab = [];
{ // servidor congela 5 s e volta
  const r = run('servidor parado por 5 s e retomado', { profile: P.medio, duration: 30000, onTime: (ns, t) => { if (t === 10000) ns.serverDown = true; if (t === 15000) ns.serverDown = false; },
    after: (ns, cs) => ({ pendentes_cliente: cs.map(c => c.net.pending.length), tick_cliente_menos_servidor: cs.map(c => c.net.w.s.tick - ns.room.world.s.tick) }) }, true);
  stab.push(r);
}
{ // entrada e saída de jogadores + migração de dono
  const r = run('entra/sai jogador + dono cai (migração)', { clients: 4, map: 'v2', profile: P.medio, duration: 30000, onTime: (ns, t, cs) => {
      if (t === 8000) ns.dropClient(cs[0]);                                           // o dono sai
      if (t === 12000) cs.push(ns.addClient({ profile: P.medio, behavior: 'bot', nick: 'Novo' }));
      if (t === 20000) ns.dropClient(cs[2]);
    }, after: (ns, cs) => ({ dono_atual: ns.room.admin() && ns.room.admin().nick, jogadores_na_sala: ns.room.size, erros_servidor: ns.room.m.invalid }) }, true);
  stab.push(r);
}
{ // cliente perde a conexão e reconecta
  const r = run('cliente cai por 3 s e reconecta', { profile: P.medio, duration: 25000, onTime: (ns, t, cs) => {
      if (t === 8000) { cs[1].connected = false; ns.room.leave(cs[1].sc); }
      if (t === 11000) { cs[1].net.reset(); cs[1].join(); }
    }, after: (ns, cs) => ({ vaga_apos_reconectar: cs[1].net.slot, estado_ok: cs[1].net.hasBase }) }, true);
  stab.push(r);
}
const fmt = x => JSON.stringify(x);
console.log('\n=== COMPARAÇÃO sem predição × com predição ===');
for (let i = 0; i < out.length; i += 2) {
  const a = out[i], b = out[i + 1];
  console.log('\n# ' + a.cenario);
  if (a.latencia_input_ms) console.log('  latência de input (ms)  sem: ' + a.latencia_input_ms.media + ' (p95 ' + a.latencia_input_ms.p95 + ')   com: ' + b.latencia_input_ms.media + ' (p95 ' + b.latencia_input_ms.p95 + ')');
  console.log('  divergência autoritativa (cliente decodificado x servidor, mesmo tick): sem ' + a.divergencia_autoritativa_m.max + ' m | com ' + b.divergencia_autoritativa_m.max + ' m');
  console.log('  erro de predição (m): ' + fmt(b.erro_predicao_m) + '   correção suavizada na tela (m): ' + fmt(b.correcao_suavizada_m));
  console.log('  rede: ' + b.snapshots_por_s + ' snap/s, ' + b.kib_s_por_cliente + ' KiB/s por cliente, lacunas ' + b.lacunas_snapshot + ', starved ' + b.entradas_repetidas_starved + ', trim ' + b.entradas_descartadas_trim + ', fila ' + b.fila_servidor_media);
  console.log('  servidor: tick ' + fmt(b.tick_servidor_us) + ' µs, heap Δ ' + b.heap_delta_MB + ' MB, placar ' + b.placar_servidor + ' ok=' + b.placar_ok);
}
console.log('\n=== ESTABILIDADE ===');
for (const r of stab) console.log('# ' + r.cenario + '\n  ' + fmt({ erro: r.erro_predicao_m, extra: r.extra, starved: r.entradas_repetidas_starved, trim: r.entradas_descartadas_trim, placar_ok: r.placar_ok }));
const jf = process.argv.indexOf('--json'); if (jf > 0) fs.writeFileSync(process.argv[jf + 1], JSON.stringify({ comparacao: out, estabilidade: stab }, null, 1));
