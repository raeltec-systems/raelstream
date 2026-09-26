import { z } from 'zod';
import { SourceSummary } from './pairing.js';
import { Profile } from './media.js';

export const SessionLifecycle = z.enum([
  'DRAFT',
  'PREPARING',
  'READY',
  'STARTING',
  'SENDING',
  'PARTIAL',
  'RECOVERING',
  'STOPPING',
  'ENDED',
  'INTERRUPTED',
]);
export type SessionLifecycle = z.infer<typeof SessionLifecycle>;

export const SessionMode = z.enum(['rehearsal', 'ingest_test', 'live']);
export type SessionMode = z.infer<typeof SessionMode>;

export const SessionSnapshot = z.object({
  id: z.string().uuid(),
  name: z.string(),
  lifecycle: SessionLifecycle,
  mode: SessionMode,
  generation: z.number().int().positive(),
  sources: z.array(SourceSummary),
  lastSequence: z.number().int().nonnegative(),
  /** The programme size the media node is running at (private test or live), if it is running. */
  runningProfile: Profile.nullable().optional(),
  /** The media node is recording the programme privately (a private test or a live service). */
  recording: z.boolean().optional(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshot>;

export const CreateSessionRequest = z.object({
  name: z.string().trim().min(1).max(80),
  presetId: z.string().uuid().optional(),
});

export const IngestResponse = z.object({
  whipUrl: z.string().url(),
  bearer: z.string(),
  expiresAt: z.string(),
  /** 'relay' forces the contribution through TURN (diagnostics; the Codespaces topology). */
  iceTransportPolicy: z.enum(['all', 'relay']).optional(),
  iceServers: z.array(
    z.object({
      urls: z.union([z.string(), z.array(z.string())]),
      username: z.string().optional(),
      credential: z.string().optional(),
    }),
  ),
});
export type IngestResponse = z.infer<typeof IngestResponse>;

/** Event envelope (B§21.3). */
export const SessionEvent = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string(),
  sessionId: z.string(),
  sessionGeneration: z.number().int(),
  sequence: z.number().int(),
  type: z.string(),
  severity: z.enum(['info', 'warn', 'critical']),
  occurredAt: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type SessionEvent = z.infer<typeof SessionEvent>;
