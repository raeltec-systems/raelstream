import type { ErrorCode } from '@raelstream/contracts';

const STATUS: Partial<Record<ErrorCode, number>> = {
  AUTH_REQUIRED: 401,
  AUTH_INVALID: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  RATE_LIMITED: 429,
  PAIR_INVALID: 410,
  PAIR_SLOT_TAKEN: 409,
  SESSION_ACTIVE_EXISTS: 409,
  STALE_GENERATION: 409,
  LEASE_HELD: 409,
};

/** Safe, volunteer-readable messages; never include internals (B§21.4). */
const MESSAGES: Partial<Record<ErrorCode, string>> = {
  AUTH_REQUIRED: 'Please sign in.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: 'That was not found.',
  VALIDATION: 'Some details were not valid.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  PAIR_INVALID: 'This code is no longer valid. Ask the studio for a new one.',
  PAIR_SLOT_TAKEN: 'A camera is already connected. Remove it in the studio first.',
  SESSION_ACTIVE_EXISTS: 'Another service is already running.',
  STALE_GENERATION: 'Another studio has taken over this service.',
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly component: 'auth' | 'session' | 'camera' | 'contribution' | 'system' = 'system',
    readonly retryable = false,
  ) {
    super(MESSAGES[code] ?? 'Something went wrong.');
  }
  get status(): number {
    return STATUS[this.code] ?? 500;
  }
}
