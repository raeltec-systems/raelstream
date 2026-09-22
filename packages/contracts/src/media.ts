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
  fallbackGraceS: z.number().int().min(60).max(600),
  stopRequestedAt: z.string().nullable(),
  endOnStop: z.boolean(),
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
});
export type DestinationSummary = z.infer<typeof DestinationSummary>;

export const StartRequest = z.object({
  mode: z.enum(['ingest_test', 'live']),
  profile: Profile,
  destinationIds: z.array(z.string().uuid()).max(2),
});
export type StartRequest = z.infer<typeof StartRequest>;
