/* proto.js - protocolo binário do FutHub (usado por servidor Node e navegador).
 *
 * Cliente -> servidor (binário):  INPUT  [1][n] n * { u32 seq, i8 x, i8 y, u8 flags(1=chute,2=passe) }
 *                                 PING   [2][f64 tempo_do_cliente_ms]
 * Servidor -> cliente (binário):  PONG   [3][f64 eco][u32 tick_servidor]
 *                                 SNAP   [4]... (ver encodeSnapshot) - completo ou delta
 * Controle (entrar, trocar de time, chat, fim da partida, eventos de som): JSON em quadros de texto.
 *
 * O snapshot delta só carrega entidades que mudaram desde o último snapshot ENVIADO àquele cliente
 * (TCP entrega em ordem, então a base é sempre a mesma nos dois lados). A cada KEYFRAME_TICKS e ao
 * entrar/pedir ressincronização, vai um snapshot completo. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FHProto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const T = { INPUT: 1, PING: 2, PONG: 3, SNAP: 4 };
  const KEYFRAME_TICKS = 120;
  const MAX_INPUTS_PER_PACKET = 8;
  const SIG = 11;   // x,y,vx,vy,ix,iy,kickBuf,passBuf,lock,lastAct,present

  function encodeInputs(list) {            // list: [{seq,x,y,kick,pass}]
    const n = Math.min(list.length, MAX_INPUTS_PER_PACKET), b = new Uint8Array(2 + n * 7), dv = new DataView(b.buffer);
    b[0] = T.INPUT; b[1] = n;
    for (let i = 0; i < n; i++) {
      const o = 2 + i * 7, it = list[list.length - n + i];
      dv.setUint32(o, it.seq >>> 0); dv.setInt8(o + 4, it.x); dv.setInt8(o + 5, it.y); b[o + 6] = (it.kick ? 1 : 0) | (it.pass ? 2 : 0);
    }
    return b;
  }
  // devolve null se malformado (o servidor nunca confia no que chega)
  function decodeInputs(u8) {
    if (u8.length < 2 || u8[0] !== T.INPUT) return null;
    const n = u8[1];
    if (n === 0 || n > MAX_INPUTS_PER_PACKET || u8.length !== 2 + n * 7) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), out = [];
    for (let i = 0; i < n; i++) {
      const o = 2 + i * 7, f = u8[o + 6];
      if (f & ~3) return null;
      let x = dv.getInt8(o + 4), y = dv.getInt8(o + 5);
      if (x === -128) x = -127; if (y === -128) y = -127;
      out.push({ seq: dv.getUint32(o), x, y, kick: f & 1, pass: (f >> 1) & 1 });
    }
    return out;
  }
  function encodePing(t) { const b = new Uint8Array(9), dv = new DataView(b.buffer); b[0] = T.PING; dv.setFloat64(1, t); return b; }
  function encodePong(t, tick) { const b = new Uint8Array(13), dv = new DataView(b.buffer); b[0] = T.PONG; dv.setFloat64(1, t); dv.setUint32(9, tick >>> 0); return b; }

  function sigOf(s, e, out, o) {            // assinatura numérica de uma entidade (0 = bola)
    if (e === 0) { const b = s.ball; out[o] = b.x; out[o + 1] = b.y; out[o + 2] = b.vx; out[o + 3] = b.vy; for (let k = 4; k < SIG; k++) out[o + k] = 0; out[o + 10] = 1; return; }
    const p = s.players[e - 1];
    out[o] = p.x; out[o + 1] = p.y; out[o + 2] = p.vx; out[o + 3] = p.vy; out[o + 4] = p.ix | 0; out[o + 5] = p.iy | 0;
    out[o + 6] = p.kickBuf; out[o + 7] = p.passBuf; out[o + 8] = p.lock; out[o + 9] = p.lastAct; out[o + 10] = p.present ? 1 : 0;
  }
  // basis: { sig: Float32Array|null, lastFullTick } por cliente; é atualizado aqui.
  function encodeSnapshot(s, ack, qlen, basis, forceFull) {
    const n = s.players.length, ents = n + 1;
    if (!basis.sig || basis.sig.length !== ents * SIG) { basis.sig = new Float32Array(ents * SIG); basis.has = false; }
    const full = forceFull || !basis.has || (s.tick - basis.lastFullTick) >= KEYFRAME_TICKS;
    const cur = new Float32Array(ents * SIG), changed = [];
    for (let e = 0; e < ents; e++) {
      sigOf(s, e, cur, e * SIG);
      let diff = full;
      if (!diff) for (let k = 0; k < SIG; k++) if (cur[e * SIG + k] !== basis.sig[e * SIG + k]) { diff = true; break; }
      if (diff && (e === 0 || s.players[e - 1].present || cur[e * SIG + 10] !== basis.sig[e * SIG + 10])) changed.push(e);
    }
    const maskLen = (ents + 7) >> 3, r = s.restart;
    const size = 31 + (r ? 14 : 0) + 1 + n + maskLen + changed.reduce((a, e) => a + (e === 0 ? 16 : 22), 0);
    const b = new Uint8Array(size), dv = new DataView(b.buffer);
    let o = 0;
    b[o++] = T.SNAP; b[o++] = (full ? 1 : 0) | (r ? 2 : 0);
    dv.setUint32(o, s.tick >>> 0); o += 4; dv.setUint32(o, ack >>> 0); o += 4;
    b[o++] = Math.min(255, qlen); b[o++] = s.phase; b[o++] = s.red; b[o++] = s.blue;
    dv.setUint32(o, s.timeTicks); o += 4; dv.setUint16(o, s.cd); o += 2; dv.setUint16(o, s.goalT); o += 2;
    b[o++] = s.goalTeam; b[o++] = s.lastTouchTeam; dv.setInt8(o++, s.lastTouchSlot); dv.setInt8(o++, s.lastScorer);
    b[o++] = s.restartTeam || 0; b[o++] = s.barrierTeam || 0; b[o++] = s.overtime ? 1 : 0;
    if (r) { b[o++] = r.type; b[o++] = r.team; dv.setFloat32(o, r.x); o += 4; dv.setFloat32(o, r.y); o += 4; dv.setUint16(o, r.t); o += 2; }
    b[o++] = n;
    for (let i = 0; i < n; i++) b[o++] = (s.players[i].present ? 1 : 0) | (s.players[i].team << 1);
    const mo = o; o += maskLen;
    for (const e of changed) {
      b[mo + (e >> 3)] |= 1 << (e & 7);
      const base = e * SIG;
      for (let k = 0; k < 4; k++) { dv.setFloat32(o, cur[base + k]); o += 4; }
      if (e > 0) { dv.setInt8(o++, cur[base + 4]); dv.setInt8(o++, cur[base + 5]); b[o++] = cur[base + 6]; b[o++] = cur[base + 7]; b[o++] = cur[base + 8]; b[o++] = cur[base + 9]; }
      basis.sig.set(cur.subarray(base, base + SIG), base);
    }
    if (full) { basis.lastFullTick = s.tick; basis.has = true; }
    return b.subarray(0, o);
  }

  // Decodifica e aplica sobre "auth" (estado autoritativo acumulado no cliente). Retorna metadados.
  // auth: { players:[...], ball:{}, restart, ... } (mesma forma de FHSim state). make: cria jogador vazio.
  function decodeSnapshot(u8, auth, makePlayer) {
    if (u8[0] !== T.SNAP) return null;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let o = 1;
    const flags = u8[o++], full = !!(flags & 1), hasR = !!(flags & 2);
    const meta = { full };
    auth.tick = dv.getUint32(o); o += 4; meta.ack = dv.getInt32(o); o += 4; // -1 é o ACK sentinela antes da primeira entrada
    meta.qlen = u8[o++]; auth.phase = u8[o++]; auth.red = u8[o++]; auth.blue = u8[o++];
    auth.timeTicks = dv.getUint32(o); o += 4; auth.cd = dv.getUint16(o); o += 2; auth.goalT = dv.getUint16(o); o += 2;
    auth.goalTeam = u8[o++]; auth.lastTouchTeam = u8[o++]; auth.lastTouchSlot = dv.getInt8(o++); auth.lastScorer = dv.getInt8(o++);
    auth.restartTeam = u8[o++]; auth.barrierTeam = u8[o++]; auth.overtime = !!u8[o++];
    if (hasR) { auth.restart = { type: u8[o++], team: u8[o++], x: dv.getFloat32(o), y: dv.getFloat32(o + 4), t: dv.getUint16(o + 8) }; o += 10; }
    else auth.restart = null;
    const n = u8[o++];
    while (auth.players.length < n) auth.players.push(makePlayer());
    for (let i = 0; i < n; i++) { const v = u8[o++], p = auth.players[i]; const was = p.present; p.present = !!(v & 1); p.team = v >> 1; if (!p.present) { p.x = p.y = -100; p.vx = p.vy = 0; } meta.rosterChanged = meta.rosterChanged || was !== p.present; }
    const maskLen = (n + 1 + 7) >> 3, mo = o; o += maskLen;
    for (let e = 0; e <= n; e++) {
      if (!(u8[mo + (e >> 3)] & (1 << (e & 7)))) continue;
      const t = e === 0 ? auth.ball : auth.players[e - 1];
      t.x = dv.getFloat32(o); t.y = dv.getFloat32(o + 4); t.vx = dv.getFloat32(o + 8); t.vy = dv.getFloat32(o + 12); o += 16;
      if (e > 0) { t.ix = dv.getInt8(o++); t.iy = dv.getInt8(o++); t.kickBuf = u8[o++]; t.passBuf = u8[o++]; t.lock = u8[o++]; t.lastAct = u8[o++]; }
    }
    return meta;
  }
  return { T, KEYFRAME_TICKS, MAX_INPUTS_PER_PACKET, encodeInputs, decodeInputs, encodePing, encodePong, encodeSnapshot, decodeSnapshot };
});
