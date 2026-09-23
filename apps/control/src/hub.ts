import type { Principal } from './auth.js';
import type { WebSocket } from 'ws';
import type { Kysely } from 'kysely';
import {
  ClientMessage,
  WS_MAX_BYTES,
  type ServerMessage,
  type SessionEvent,
} from '@raelstream/contracts';
import type { DB } from './db.js';
import { eventsSince, snapshot } from './sessions.js';
import { renewCredential, sourceByCredential } from './pairing.js';
import { RateLimiter } from './ratelimit.js';
import { readObserved } from './observed.js';
import type { ObservedState, SessionLifecycle } from '@raelstream/contracts';

type Conn =
  | { role: 'unauth'; principal: Promise<Principal | null> }
  | { role: 'studio'; sessionId: string; clientId: string; userId: string }
  | { role: 'camera'; sessionId: string; sourceId: string; admitted: boolean };

const RENEW_EVERY_MS = 5 * 60_000;

/**
 * Session WebSocket hub (SPEC §17.2). Relays WebRTC signalling between the phone and studio without
 * logging or persisting SDP/ICE; validates every message; enforces size and rate limits.
 */
export class Hub {
  private conns = new Map<WebSocket, Conn>();
  private msgLimit = new RateLimiter(50, 10_000);
  private badLimit = new RateLimiter(10, 10_000);
  private renewTimer: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: Kysely<DB>,
    private readonly log: { warn: (o: object, m: string) => void },
  ) {
    this.renewTimer = setInterval(() => void this.renewAll(), RENEW_EVERY_MS);
    this.renewTimer.unref();
  }

  attach(ws: WebSocket, principal: Promise<Principal | null>): void {
    this.conns.set(ws, { role: 'unauth', principal });
    const id = crypto.randomUUID();
    ws.on('message', (raw, isBinary) => void this.onMessage(ws, id, raw as Buffer, isBinary));
    ws.on('close', () => this.onClose(ws));
    // Unauthenticated sockets must say hello quickly.
    setTimeout(() => {
      if (this.conns.get(ws)?.role === 'unauth') ws.close(4401, 'hello timeout');
    }, 10_000).unref();
  }

  close(): void {
    clearInterval(this.renewTimer);
    for (const ws of this.conns.keys()) ws.close(1001, 'shutdown');
  }

  broadcastEvent(sessionId: string, event: SessionEvent): void {
    this.toStudios(sessionId, { type: 'event', event });
  }

  /** The studio tab that lost the lease becomes read-only (A33). */
  notifyLeaseLost(sessionId: string, clientId: string): void {
    for (const [ws, c] of this.conns) {
      if (c.role === 'studio' && c.sessionId === sessionId && c.clientId === clientId)
        this.send(ws, { type: 'lease.lost' });
    }
  }

  /** After a takeover the phone renegotiates with the new studio tab, keeping its slot (E37). */
  notifyStudioChanged(sessionId: string): void {
    for (const [ws, c] of this.conns)
      if (c.role === 'camera' && c.sessionId === sessionId)
        this.send(ws, { type: 'studio.changed' });
  }

  broadcastObserved(
    sessionId: string,
    lifecycle: SessionLifecycle,
    observed: ObservedState | null,
  ): void {
    this.toStudios(sessionId, { type: 'observed', lifecycle, observed });
  }

  async broadcastSnapshot(sessionId: string): Promise<void> {
    this.toStudios(sessionId, { type: 'snapshot', snapshot: await snapshot(this.db, sessionId) });
  }

  notifyCamera(sourceId: string, msg: ServerMessage, closeAfter = false): void {
    for (const [ws, c] of this.conns) {
      if (c.role === 'camera' && c.sourceId === sourceId) {
        if (msg.type === 'admitted') c.admitted = true;
        this.send(ws, msg);
        if (closeAfter) ws.close(4403, 'revoked');
      }
    }
  }

  cameraPresent(sourceId: string): boolean {
    for (const c of this.conns.values())
      if (c.role === 'camera' && c.sourceId === sourceId) return true;
    return false;
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private toStudios(sessionId: string, msg: ServerMessage): void {
    for (const [ws, c] of this.conns)
      if (c.role === 'studio' && c.sessionId === sessionId) this.send(ws, msg);
  }

  private bad(ws: WebSocket, id: string): void {
    if (!this.badLimit.allow(id)) ws.close(4400, 'too many invalid messages');
  }

  private async onMessage(
    ws: WebSocket,
    id: string,
    raw: Buffer,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary || raw.length > WS_MAX_BYTES) return this.bad(ws, id);
    if (!this.msgLimit.allow(id)) return this.bad(ws, id);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString('utf8'));
    } catch {
      return this.bad(ws, id);
    }
    const r = ClientMessage.safeParse(parsed);
    if (!r.success) return this.bad(ws, id);
    const msg = r.data;
    const conn = this.conns.get(ws);
    if (!conn) return;

    if (msg.type === 'ping') return this.send(ws, { type: 'pong' });

    if (msg.type === 'hello') {
      if (conn.role !== 'unauth') return;
      if (msg.role === 'studio') {
        const principal = await conn.principal;
        if (!principal) return void ws.close(4401, 'auth required');
        let snap;
        try {
          snap = await snapshot(this.db, msg.sessionId);
        } catch {
          return void ws.close(4404, 'no session');
        }
        this.conns.set(ws, {
          role: 'studio',
          sessionId: msg.sessionId,
          clientId: msg.clientId,
          userId: principal.userId,
        });
        this.send(ws, { type: 'welcome', role: 'studio', snapshot: snap });
        if (msg.lastSequence !== undefined) {
          const missed = await eventsSince(this.db, msg.sessionId, msg.lastSequence);
          for (const event of missed) this.send(ws, { type: 'event', event });
        }
        for (const s of snap.sources)
          this.send(ws, { type: 'peer', sourceId: s.id, present: this.cameraPresent(s.id) });
        const obs = await readObserved(this.db, msg.sessionId);
        if (obs)
          this.send(ws, { type: 'observed', lifecycle: obs.lifecycle, observed: obs.observed });
        return;
      }
      const src = await sourceByCredential(this.db, msg.credential);
      if (!src) return void ws.close(4403, 'invalid credential');
      // A reconnecting phone replaces its own previous socket, never another device's slot (B§8.3).
      for (const [other, c] of this.conns)
        if (c.role === 'camera' && c.sourceId === src.id) other.close(4409, 'replaced');
      this.conns.set(ws, {
        role: 'camera',
        sessionId: src.session_id,
        sourceId: src.id,
        admitted: src.status === 'admitted',
      });
      this.send(ws, {
        type: 'welcome',
        role: 'camera',
        sourceId: src.id,
        sourceStatus: src.status,
        serviceName: src.service_name,
      });
      this.toStudios(src.session_id, { type: 'peer', sourceId: src.id, present: true });
      return;
    }

    if (msg.type === 'signal') {
      if (conn.role === 'camera') {
        if (!conn.admitted || msg.sourceId !== conn.sourceId) return this.bad(ws, id);
        return this.toStudios(conn.sessionId, {
          type: 'signal',
          sourceId: conn.sourceId,
          payload: msg.payload,
        });
      }
      if (conn.role === 'studio') {
        for (const [cws, c] of this.conns) {
          if (
            c.role === 'camera' &&
            c.sourceId === msg.sourceId &&
            c.sessionId === conn.sessionId &&
            c.admitted
          ) {
            this.send(cws, { type: 'signal', sourceId: msg.sourceId, payload: msg.payload });
          }
        }
      }
      return;
    }

    if (msg.type === 'tally' && conn.role === 'studio') {
      for (const [cws, c] of this.conns) {
        if (c.role === 'camera' && c.sourceId === msg.sourceId && c.sessionId === conn.sessionId)
          this.send(cws, { type: 'tally', state: msg.state });
      }
    }
  }

  private onClose(ws: WebSocket): void {
    const c = this.conns.get(ws);
    this.conns.delete(ws);
    if (c?.role === 'camera' && !this.cameraPresent(c.sourceId))
      this.toStudios(c.sessionId, { type: 'peer', sourceId: c.sourceId, present: false });
  }

  private async renewAll(): Promise<void> {
    for (const [ws, c] of this.conns) {
      if (c.role !== 'camera' || !c.admitted) continue;
      try {
        const r = await renewCredential(this.db, c.sourceId);
        if (r)
          this.send(ws, { type: 'admitted', credential: r.credential, expiresAt: r.expiresAt });
      } catch (e) {
        this.log.warn({ err: (e as Error).message }, 'credential renewal failed');
      }
    }
  }
}
