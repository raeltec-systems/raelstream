import { z } from 'zod';

export const Profile = z.enum(['full_hd', 'reliable_hd']);
export type Profile = z.infer<typeof Profile>;

/** Destination states (B§16.3). SENDING is transport-level; it never claims public playback. */
export const DestinationState = z.enum([
  'NOT_CONFIGURED',
  'READY_UNVERIFIED',
  'CONNECTING',
  'SENDING',
  'LIVE_CONFIRMED',
  'RECONNECTING',
  'FAILED',
  'STOPPED',
]);
export type DestinationState = z.infer<typeof DestinationState>;

export const DestinationFailure = z.enum([
  'DEST_AUTH_REJECTED',
  'DEST_MEDIA_REJECTED',
  'DEST_NETWORK',
  'DEST_URL_NOT_ALLOWED',
  'DEST_ADDRESS_NOT_PUBLIC',
  'DEST_KEY_MISSING',
]);
export type DestinationFailure = z.infer<typeof DestinationFailure>;

/** What the control service wants the media node to do (SPEC §12.1). Written by control only. */
export const DesiredState = z.object({
  generation: z.number().int(),
  mode: z.enum(['ingest_test', 'live']),
  profile: Profile,
  normaliser: z.enum(['running', 'stopped']),
  publishers: z.record(
    z.string().uuid(),
    z.object({ state: z.enum(['running', 'stopped']), retryNonce: z.number().int() }),
  ),
  /** 60–600 s from the preset; the operator may extend it to at most 1200 s while recovering. */
  fallbackGraceS: z.number().int().min(60).max(1200),
  stopRequestedAt: z.string().nullable(),
  endOnStop: z.boolean(),
  /** Record a private copy of the public output (SPEC §12.7). */
  record: z.boolean().optional(),
});
export type DesiredState = z.infer<typeof DesiredState>;

export const ObservedDestination = z.object({
  state: DestinationState,
  since: z.string(),
  attempts: z.number().int(),
  failure: DestinationFailure.nullable(),
  bitrateKbps: z.number().nullable(),
  sendingSince: z.string().nullable(),
});
export type ObservedDestination = z.infer<typeof ObservedDestination>;

/** What the supervisor actually sees. Written by the supervisor only. Missing data stays null. */
export const ObservedState = z.object({
  generation: z.number().int(),
  updatedAt: z.string(),
  contribution: z.object({
    state: z.enum(['absent', 'present', 'lost']),
    since: z.string(),
    tracks: z.array(z.string()),
  }),
  normaliser: z.object({
    state: z.enum(['stopped', 'waiting', 'running', 'stalled']),
    since: z.string(),
    speed: z.number().nullable(),
    fps: z.number().nullable(),
  }),
  fallback: z.object({
    active: z.boolean(),
    since: z.string().nullable(),
    graceEndsAt: z.string().nullable(),
  }),
  destinations: z.record(z.string(), ObservedDestination),
});
export type ObservedState = z.infer<typeof ObservedState>;

export const DestinationSummary = z.object({
  id: z.string().uuid(),
  platform: z.enum(['facebook', 'youtube']),
  label: z.string(),
  keyLast4: z.string().nullable(),
  keyMode: z.enum(['persistent', 'per_event']),
  autoPublishesOnIngest: z.enum(['yes', 'no', 'unknown']),
  watchUrl: z.string().nullable(),
  serverUrl: z.string(),
  eventReference: z.string(),
  keyUpdatedAt: z.string().nullable(),
});
export type DestinationSummary = z.infer<typeof DestinationSummary>;

/** Owner form for a destination (SPEC §13.1). The key is write-only and never returned. */
export const DestinationInput = z.object({
  platform: z.enum(['facebook', 'youtube']),
  label: z.string().trim().min(1).max(60),
  serverUrl: z.string().max(300),
  keyMode: z.enum(['persistent', 'per_event']),
  autoPublishesOnIngest: z.enum(['yes', 'no', 'unknown']),
  watchUrl: z
    .string()
    .trim()
    .max(300)
    .regex(/^https:\/\/([a-z0-9-]+\.)*(facebook\.com|youtube\.com|youtu\.be)(\/.*)?$/i)
    .nullable()
    .or(z.literal('').transform(() => null)),
  eventReference: z.string().trim().max(120).default(''),
  key: z.string().max(400).optional(),
});
export type DestinationInput = z.infer<typeof DestinationInput>;

/** Per-service state of a destination: the per-event key ending and the operator's confirmation. */
export const SessionDestination = z.object({
  destinationId: z.string().uuid(),
  sessionKeyLast4: z.string().nullable(),
  sessionKeyPresent: z.boolean(),
  liveConfirmation: z.object({ by: z.string(), at: z.string() }).nullable(),
});
export type SessionDestination = z.infer<typeof SessionDestination>;

/** Uplink test result (SPEC §11.3). */
export const UplinkResult = z.object({
  httpMbps: z.number().nonnegative(),
  bytes: z.number().int().nonnegative(),
  seconds: z.number().positive(),
  offer: z.enum(['full_hd', 'reliable_hd', 'insufficient']),
  measuredAt: z.string(),
});
export type UplinkResult = z.infer<typeof UplinkResult>;

/** SPEC §11.3: full_hd at ≥ 12 Mb/s, reliable_hd at ≥ 7 Mb/s, otherwise insufficient. */
export function uplinkOffer(mbps: number): UplinkResult['offer'] {
  return mbps >= 12 ? 'full_hd' : mbps >= 7 ? 'reliable_hd' : 'insufficient';
}

export const StartRequest = z.object({
  mode: z.enum(['ingest_test', 'live']),
  profile: Profile,
  destinationIds: z.array(z.string().uuid()).max(2),
  record: z.boolean().optional(),
});
export type StartRequest = z.infer<typeof StartRequest>;
