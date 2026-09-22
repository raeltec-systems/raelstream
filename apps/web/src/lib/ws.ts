import { ServerMessage, type ClientMessage } from '@raelstream/contracts';

export type Handler = (m: ServerMessage) => void;

/**
 * Reconnecting session socket. `hello` is re-sent on every (re)connect, so the server can replay missed
 * events from the last sequence (SPEC §17.2). Messages that fail schema validation are ignored.
 */
export class SessionSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  status: 'connecting' | 'open' | 'closed' = 'connecting';
  onStatus: (s: SessionSocket['status'], closeCode?: number) => void = () => {};

  constructor(
    private readonly hello: () => ClientMessage,
    private readonly onMessage: Handler,
    private readonly fatalCodes = [4401, 4403, 4404, 4409],
  ) {
    this.connect();
  }

  send(m: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.ping) clearInterval(this.ping);
    this.ws?.close();
  }

  private connect(): void {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.setStatus('connecting');
    ws.onopen = () => {
      this.attempt = 0;
      ws.send(JSON.stringify(this.hello()));
      this.setStatus('open');
      this.ping = setInterval(() => this.send({ type: 'ping' }), 20_000);
    };
    ws.onmessage = (e) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(e.data));
      } catch {
        return;
      }
      const r = ServerMessage.safeParse(raw);
      if (r.success) this.onMessage(r.data);
    };
    ws.onclose = (e) => {
      if (this.ping) clearInterval(this.ping);
      if (this.closed) return;
      if (this.fatalCodes.includes(e.code)) {
        this.closed = true;
        this.setStatus('closed', e.code);
        return;
      }
      this.setStatus('connecting');
      // Bounded exponential backoff with jitter: 1, 2, 4, 8, 15 s (B§17.1).
      const base = [1, 2, 4, 8, 15][Math.min(this.attempt++, 4)]! * 1000;
      this.timer = setTimeout(() => this.connect(), base * (0.8 + Math.random() * 0.4));
    };
  }

  private setStatus(s: SessionSocket['status'], code?: number): void {
    this.status = s;
    this.onStatus(s, code);
  }
}
