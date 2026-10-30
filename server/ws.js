'use strict';
/* WebSocket (RFC 6455) mínimo, sem dependências. Só o necessário para o FutHub:
   handshake, quadros texto/binário, ping/pong, close, fragmentação, limite de tamanho e TCP_NODELAY. */
const crypto = require('crypto');
const { EventEmitter } = require('events');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

class WSConn extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.socket = socket; this.maxPayload = maxPayload; this.open = true;
    this.buf = Buffer.alloc(0); this.frag = null; this.fragBytes = 0; this.fragBin = false;
    this.bytesIn = 0; this.bytesOut = 0; this.msgsIn = 0;
    socket.setNoDelay(true); socket.setTimeout(0);
    socket.on('data', d => this._onData(d));
    socket.on('close', () => this._closed());
    socket.on('error', () => this._closed());
  }
  get buffered() { return this.socket.writableLength; }   // bytes ainda não enviados (contrapressão)
  _closed() { if (!this.open) return; this.open = false; this.buf = Buffer.alloc(0); this.frag = null; this.fragBytes = 0; this.emit('close'); }
  _onData(d) {
    this.bytesIn += d.length;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    try { while (this._parse()); } catch (e) { this.close(1002); }
  }
  _parse() {
    const b = this.buf;
    if (b.length < 2) return false;
    const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
    let n = b[1] & 0x7f, off = 2;
    if (!masked) throw new Error('unmasked');
    if (n === 126) { if (b.length < 4) return false; n = b.readUInt16BE(2); off = 4; }
    else if (n === 127) { if (b.length < 10) return false; const hi = b.readUInt32BE(2); if (hi) throw new Error('big'); n = b.readUInt32BE(6); off = 10; }
    if (n > this.maxPayload) { this.close(1009); this.buf = Buffer.alloc(0); return false; }
    if (b.length < off + 4 + n) return false;
    const mask = b.subarray(off, off + 4), payload = Buffer.from(b.subarray(off + 4, off + 4 + n));
    for (let i = 0; i < n; i++) payload[i] ^= mask[i & 3];
    this.buf = b.subarray(off + 4 + n);
    if (op >= 8) {                                  // controle
      if (op === 8) { this.cleanClose = true; this.close(1000); return false; }
      if (op === 9) this._frame(10, payload);
      return true;
    }
    if (op === 0 && this.frag) {
      if (this.fragBytes + n > this.maxPayload) { this.close(1009); return false; }
      this.frag.push(payload);
      this.fragBytes += n;
      if (fin) { const p = Buffer.concat(this.frag), bin = this.fragBin; this.frag = null; this.fragBytes = 0; this._msg(p, bin); }
    } else if (op === 1 || op === 2) {
      if (fin) this._msg(payload, op === 2); else { this.frag = [payload]; this.fragBytes = n; this.fragBin = op === 2; }
    } else throw new Error('opcode');
    return true;
  }
  _msg(p, bin) { this.msgsIn++; this.emit('message', bin ? p : p.toString('utf8'), bin); }
  _frame(op, payload) {
    if (!this.open) return false;
    const n = payload.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255])
      : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeUInt32BE(n, 6); return h; })();
    this.bytesOut += head.length + n;
    return this.socket.write(Buffer.concat([head, payload]));
  }
  send(data) {
    if (typeof data === 'string') return this._frame(1, Buffer.from(data));
    return this._frame(2, Buffer.isBuffer(data) ? data : Buffer.from(data));
  }
  close(code) {
    if (!this.open) return;
    const p = Buffer.alloc(2); p.writeUInt16BE(code || 1000);
    try { this._frame(8, p); this.socket.end(); } catch (e) {}
    setTimeout(() => this.socket.destroy(), 500).unref();
    this._closed();
  }
}

// Usa: server.on('upgrade', (req, socket, head) => ws.upgrade(req, socket, { maxPayload, verifyOrigin }, conn => {...}))
function upgrade(req, socket, opts, onConn) {
  const key = req.headers['sec-websocket-key'];
  if (req.headers.upgrade !== 'websocket' || !key || req.headers['sec-websocket-version'] !== '13') {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return null;
  }
  if (opts.verifyOrigin && !opts.verifyOrigin(req)) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return null; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const c = new WSConn(socket, opts.maxPayload || 4096);
  onConn(c);
  return c;
}
module.exports = { upgrade, WSConn };
