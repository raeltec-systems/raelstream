import { z } from 'zod';

/** base64url of 32 random bytes = 43 chars (SPEC §7.1). */
export const InviteToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
/** Random per-phone id kept in localStorage; base64url of 16 bytes = 22 chars. */
export const DeviceId = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
export const SourceLabel = z.string().trim().min(1).max(40);

export const CreatePairingResponse = z.object({
  invitationId: z.string().uuid(),
  url: z.string().url(),
  expiresAt: z.string(),
});
export type CreatePairingResponse = z.infer<typeof CreatePairingResponse>;

export const PreviewRequest = z.object({ token: InviteToken });
export const PreviewResponse = z.object({ serviceName: z.string(), operatorName: z.string() });
export type PreviewResponse = z.infer<typeof PreviewResponse>;

export const ClaimRequest = z.object({
  token: InviteToken,
  deviceId: DeviceId,
  label: SourceLabel,
});
export const ClaimResponse = z.object({
  sourceId: z.string().uuid(),
  sessionId: z.string().uuid(),
  verificationPhrase: z.string(),
  /** Pending credential: only allows the camera WS channel while pending/admitted. */
  credential: z.string(),
  /** The same phone took back a slot it was already admitted to: no new approval needed. */
  reclaimed: z.boolean().optional(),
});
export type ClaimResponse = z.infer<typeof ClaimResponse>;

export const SourceStatus = z.enum(['pending', 'admitted', 'rejected', 'revoked']);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const SourceSummary = z.object({
  id: z.string().uuid(),
  slot: z.number().int(),
  label: z.string(),
  status: SourceStatus,
  verificationPhrase: z.string(),
  deviceHint: z.string(),
});
export type SourceSummary = z.infer<typeof SourceSummary>;
