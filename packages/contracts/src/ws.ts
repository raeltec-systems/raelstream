import { z } from 'zod';
import { SessionSnapshot, SessionEvent } from './session.js';
import { ErrorCode } from './errors.js';
import { ObservedState } from './media.js';
import { SessionLifecycle } from './session.js';

/** Max serialized WS message size accepted by the server (SPEC §8.2). */
export const WS_MAX_BYTES = 64 * 1024;
/** SDP cap (SPEC §14.4). */
export const SDP_MAX_CHARS = 16 * 1024;

export const SignalPayload = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offer'), sdp: z.string().max(SDP_MAX_CHARS) }),
  z.object({ type: z.literal('answer'), sdp: z.string().max(SDP_MAX_CHARS) }),
  z.object({
    type: z.literal('candidate'),
    candidate: z
      .object({
        candidate: z.string().max(1024),
        sdpMid: z.string().max(64).nullable().optional(),
        sdpMLineIndex: z.number().int().nullable().optional(),
      })
      .nullable(),
  }),
]);
export type SignalPayload = z.infer<typeof SignalPayload>;

export const TallyState = z.enum(['off', 'ready', 'live']);
export type TallyState = z.infer<typeof TallyState>;

// ---- client -> server ----
export const HelloMessage = z.discriminatedUnion('role', [
  z.object({
    type: z.literal('hello'),
    role: z.literal('studio'),
    sessionId: z.string().uuid(),
    clientId: z.string().uuid(),
    lastSequence: z.number().int().optional(),
  }),
  z.object({
    type: z.literal('hello'),
    role: z.literal('camera'),
    credential: z.string().max(128),
  }),
]);

export const ClientMessage = z.union([
  HelloMessage,
  z.object({ type: z.literal('signal'), sourceId: z.string().uuid(), payload: SignalPayload }),
  z.object({ type: z.literal('tally'), sourceId: z.string().uuid(), state: TallyState }),
  z.object({ type: z.literal('ping') }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---- server -> client ----
export const ServerMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    role: z.enum(['studio', 'camera']),
    snapshot: SessionSnapshot.optional(),
    sourceId: z.string().uuid().optional(),
    sourceStatus: z.string().optional(),
    serviceName: z.string().optional(),
  }),
  z.object({ type: z.literal('snapshot'), snapshot: SessionSnapshot }),
  z.object({ type: z.literal('event'), event: SessionEvent }),
  z.object({ type: z.literal('admitted'), credential: z.string(), expiresAt: z.string() }),
  z.object({ type: z.literal('rejected') }),
  z.object({ type: z.literal('revoke') }),
  z.object({ type: z.literal('signal'), sourceId: z.string().uuid(), payload: SignalPayload }),
  z.object({ type: z.literal('tally'), state: TallyState }),
  z.object({ type: z.literal('peer'), sourceId: z.string().uuid(), present: z.boolean() }),
  z.object({ type: z.literal('error'), code: ErrorCode, message: z.string() }),
  z.object({ type: z.literal('pong') }),
  z.object({
    type: z.literal('observed'),
    lifecycle: SessionLifecycle,
    observed: ObservedState.nullable(),
  }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

// ---- RTCDataChannel "ctl" (SPEC §8.3) ----
export const CtlMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('tally'), state: TallyState, broadcast: z.string().optional() }),
  z.object({
    t: z.literal('quality'),
    label: z.enum(['good', 'reduced', 'unstable', 'disconnected']),
    fps: z.number().nullable(),
    height: z.number().nullable(),
    rttMs: z.number().nullable(),
  }),
  z.object({ t: z.literal('cam.setBitrate'), bps: z.number().int().positive() }),
  z.object({ t: z.literal('cam.setZoom'), zoom: z.number() }),
  z.object({
    t: z.literal('cam.state'),
    width: z.number().nullable(),
    height: z.number().nullable(),
    frameRate: z.number().nullable(),
    wakeLock: z.enum(['active', 'released', 'unsupported']),
    battery: z.object({ level: z.number(), charging: z.boolean() }).nullable(),
    backgrounded: z.boolean(),
    zoom: z
      .object({ min: z.number(), max: z.number(), step: z.number(), value: z.number() })
      .nullable(),
  }),
  z.object({ t: z.literal('ping'), at: z.number() }),
  z.object({ t: z.literal('pong'), at: z.number() }),
  z.object({ t: z.literal('ack'), of: z.number().int() }),
]);
export type CtlMessage = z.infer<typeof CtlMessage>;
export const CtlEnvelope = z.object({
  v: z.literal(1),
  seq: z.number().int(),
  gen: z.number().int(),
  m: CtlMessage,
});
export type CtlEnvelope = z.infer<typeof CtlEnvelope>;
