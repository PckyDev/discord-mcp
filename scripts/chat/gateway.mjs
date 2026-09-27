// Discord Gateway v10. No intents or connection are used by the ordinary MCP server.
export class Gateway {
  constructor({ token, onMessage, onReady, onError, WebSocketImpl = globalThis.WebSocket, random = Math.random }) {
    Object.assign(this, { token, onMessage, onReady, onError, WebSocketImpl, random });
    this.sequence = null; this.closed = false; this.acked = true; this.retry = 1000;
  }
  connect(url = "wss://gateway.discord.gg") {
    if (this.closed) return;
    this.url = url;
    const socket = this.socket = new this.WebSocketImpl(`${url}/?v=10&encoding=json`);
    socket.addEventListener("message", event => {
      if (socket !== this.socket) return;
      try { this.packet(JSON.parse(event.data)); } catch { this.onError("Invalid Gateway event. Reconnecting."); socket.close(); }
    });
    socket.addEventListener("error", () => { this.onError("Gateway connection error."); socket.close(); });
    socket.addEventListener("close", event => {
      clearTimeout(this.heartbeat); if (socket !== this.socket || this.closed) return;
      if ([4004, 4010, 4011, 4012, 4013, 4014].includes(event.code)) {
        this.closed = true; this.onError(`Gateway refused connection (${event.code}). Check bot token and enable Message Content intent in the Discord Developer Portal.`, true); return;
      }
      if ([4007, 4009].includes(event.code)) { this.session = null; this.sequence = null; }
      this.onError("Gateway disconnected; reconnecting.");
      this.reconnect = setTimeout(() => this.connect(this.session ? this.resumeUrl : this.url), this.retry + this.random() * 1000);
      this.retry = Math.min(this.retry * 2, 30000);
    });
  }
  send(op, d) { if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ op, d })); }
  beat() {
    if (!this.acked) { this.socket.close(); return; }
    this.acked = false; this.send(1, this.sequence);
    this.heartbeat = setTimeout(() => this.beat(), this.interval);
  }
  packet(p) {
    if (p.s !== null && p.s !== undefined) this.sequence = p.s;
    if (p.op === 10) {
      this.interval = p.d.heartbeat_interval; this.acked = true;
      clearTimeout(this.heartbeat); this.heartbeat = setTimeout(() => this.beat(), this.interval * this.random());
      if (this.session) this.send(6, { token: this.token, session_id: this.session, seq: this.sequence });
      else this.send(2, { token: this.token, intents: 1 | 512 | 32768, properties: { os: process.platform, browser: "discord-mcp", device: "discord-mcp" } });
    } else if (p.op === 11) this.acked = true;
    else if (p.op === 1) this.send(1, this.sequence);
    else if (p.op === 7) this.socket.close();
    else if (p.op === 9) { if (!p.d) { this.session = null; this.sequence = null; } this.socket.close(); }
    else if (p.op === 0) {
      if (p.t === "READY") { this.session = p.d.session_id; this.resumeUrl = p.d.resume_gateway_url; this.retry = 1000; this.user = p.d.user; this.onReady(this.user); }
      if (p.t === "RESUMED") { this.retry = 1000; this.onReady(this.user); }
      if (p.t === "MESSAGE_CREATE") this.onMessage(p.d);
    }
  }
  close() { this.closed = true; clearTimeout(this.heartbeat); clearTimeout(this.reconnect); this.socket?.close(); }
}
