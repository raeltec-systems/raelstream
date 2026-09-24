import { z } from 'zod';

/** Stable error codes (SPEC §17.1). Safe messages live in the i18n catalogue under `error.<code>`. */
export const ERROR_CODES = [
  'AUTH_INVALID',
  'AUTH_REQUIRED',
  'PASSWORD_WEAK',
  'EMAIL_TAKEN',
  'INVITE_INVALID',
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION',
  'RATE_LIMITED',
  'LEASE_HELD',
  'STALE_GENERATION',
  'SESSION_ACTIVE_EXISTS',
  'PAIR_INVALID',
  'PAIR_SLOT_TAKEN',
  'CAM_PERMISSION_DENIED',
  'CAM_IN_USE',
  'CAM_NOT_FOUND',
  'CAM_ICE_FAILED',
  'CAM_STALLED',
  'CAM_REVOKED',
  'AUDIO_DEVICE_LOST',
  'AUDIO_SILENT',
  'AUDIO_CLIPPING',
  'AUDIO_PROCESSING_NOT_DISABLED',
  'INGEST_AUTH',
  'INGEST_TIMEOUT',
  'INGEST_MEDIA_UNSUPPORTED',
  'CONTRIB_LOST',
  'DEST_NOT_CONFIGURED',
  'DEST_KEY_MISSING',
  'DEST_URL_NOT_ALLOWED',
  'NOT_SENDING',
  'ASSET_TOO_LARGE',
  'ASSET_UNSUPPORTED',
  'ASSET_CORRUPT',
  'THEME_CONTRAST',
  'INTERNAL',
] as const;

export const ErrorCode = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const Component = z.enum([
  'auth',
  'session',
  'camera',
  'audio',
  'contribution',
  'destination',
  'system',
]);
export type Component = z.infer<typeof Component>;

export const ApiError = z.object({
  code: ErrorCode,
  message: z.string(),
  component: Component,
  retryable: z.boolean(),
  action: z.string().optional(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;
