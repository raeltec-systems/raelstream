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
  PASSWORD_WEAK: 400,
  EMAIL_TAKEN: 409,
  INVITE_INVALID: 410,
  DEST_NOT_CONFIGURED: 409,
  DEST_KEY_MISSING: 409,
  NOT_SENDING: 409,
  ASSET_TOO_LARGE: 413,
  ASSET_UNSUPPORTED: 415,
  ASSET_CORRUPT: 422,
  THEME_CONTRAST: 400,
};

/** Safe, volunteer-readable messages; never include internals (B§21.4). */
const MESSAGES: Partial<Record<ErrorCode, string>> = {
  AUTH_REQUIRED: 'Please sign in.',
  AUTH_INVALID:
    "That didn't work. Check the details and try again. After several tries, wait 15 minutes.",
  PASSWORD_WEAK: 'Use a password of at least 12 characters that is not your email address.',
  EMAIL_TAKEN: 'An account with that email already exists.',
  INVITE_INVALID: 'This invite link is no longer valid. Ask the owner for a new one.',
  LEASE_HELD: 'Someone else is running the studio for this service.',
  FORBIDDEN: "You don't have permission to do that.",
  NOT_FOUND: 'That was not found.',
  VALIDATION: 'Some details were not valid.',
  RATE_LIMITED: 'Too many attempts. Wait a minute and try again.',
  PAIR_INVALID: 'This code is no longer valid. Ask the studio for a new one.',
  PAIR_SLOT_TAKEN: 'A camera is already connected. Remove it in the studio first.',
  SESSION_ACTIVE_EXISTS: 'Another service is already running.',
  STALE_GENERATION: 'Another studio has taken over this service.',
  DEST_NOT_CONFIGURED: 'A selected destination is not set up. Set it up or deselect it.',
  DEST_KEY_MISSING: 'A selected destination has no stream key. Paste the key or deselect it.',
  NOT_SENDING: 'That destination is not part of this broadcast.',
  ASSET_TOO_LARGE:
    'That image is too big. Use one under 10 MB and at most 4096 pixels on each side.',
  ASSET_UNSUPPORTED:
    'That file type is not supported. Use a still PNG, JPEG or WebP image (no SVG or animations).',
  ASSET_CORRUPT: 'That image could not be read. It may be damaged. Export it again and retry.',
  THEME_CONTRAST:
    'White text is hard to read on that colour. Choose a darker main colour (contrast at least 4.5:1).',
};

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly component:
      'auth' | 'session' | 'camera' | 'contribution' | 'destination' | 'system' = 'system',
    readonly retryable = false,
  ) {
    super(MESSAGES[code] ?? 'Something went wrong.');
  }
  get status(): number {
    return STATUS[this.code] ?? 500;
  }
}
