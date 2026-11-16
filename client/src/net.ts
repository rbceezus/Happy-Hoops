// Conexão WebSocket com reconexão automática (usa o token da sala para voltar ao mesmo assento).
import type { ClientMsg, RoomView, ServerMsg } from '../../shared/protocol';
import type { Snapshot } from '../../shared/types';

type Handlers = {
  room?: (r: RoomView) => void;
  snap?: (s: Snapshot) => void;
  err?: (m: string) => void;
  left?: () => void;
  status?: (s: 'open' | 'closed' | 'connecting') => void;
};

export class Net {
  ws: WebSocket | null = null;
  h: Handlers = {};
  rtt = 60;
  private pingTimer = 0;
  private reconnectTimer = 0;
  private closedByUs = false;
  private queue: string[] = [];
  session: { code: string; token: string } | null = null;

  constructor() {
    try {
      const s = sessionStorage.getItem('hh_session');
      if (s) this.session = JSON.parse(s);
    } catch { /* sem storage */ }
  }

  connect() {
    this.closedByUs = false;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.h.status?.('connecting');
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.h.status?.('open');
      if (this.session) this.send({ t: 'rejoin', code: this.session.code, token: this.session.token });
      for (const m of this.queue) ws.send(m);
      this.queue = [];
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping', c: performance.now() }), 2000);
    };
    ws.onmessage = (ev) => {
      let m: ServerMsg;
      try { m = JSON.parse(ev.data as string); } catch { return; }
      switch (m.t) {
        case 'room':
          this.session = { code: m.code, token: m.token };
          try { sessionStorage.setItem('hh_session', JSON.stringify(this.session)); } catch { /* ok */ }
          this.h.room?.(m); break;
        case 'snap': this.h.snap?.(m.s); break;
        case 'err': this.h.err?.(m.msg); break;
        case 'left': this.clearSession(); this.h.left?.(); break;
        case 'pong': this.rtt = this.rtt * 0.7 + (performance.now() - m.c) * 0.3; break;
      }
    };
    ws.onclose = () => {
      window.clearInterval(this.pingTimer);
      this.h.status?.('closed');
      if (!this.closedByUs) this.reconnectTimer = window.setTimeout(() => this.connect(), 1200);
    };
    ws.onerror = () => { /* onclose cuida */ };
  }

  clearSession() {
    this.session = null;
    try { sessionStorage.removeItem('hh_session'); } catch { /* ok */ }
  }

  send(m: ClientMsg) {
    const s = JSON.stringify(m);
    if (this.ws && this.ws.readyState === 1) this.ws.send(s);
    else if (m.t !== 'input' && m.t !== 'ping') this.queue.push(s);
  }

  close() {
    this.closedByUs = true;
    window.clearTimeout(this.reconnectTimer);
    window.clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
