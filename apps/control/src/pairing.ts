import type { Kysely } from 'kysely';
import type { DB } from './db.js';
import { AppError } from './errors.js';
import { randomToken, sha256, verificationPhrase } from './crypto.js';

export const INVITATION_TTL_MS = 120_000; // PAIR-01
/**
 * PAIR-05: renewed (rotated) every 5 min while the phone is connected. The lifetime is what a phone that
 * dropped out (browser closed, back pressed, battery swap) has to come back without a new code, so it
 * covers a whole service; the credential is session-bound and dies when the service ends or the
 * operator removes the camera.
 */
export const CONTRIBUTOR_TTL_MS = 3 * 60 * 60_000;
/** How long after admission a phone may still exchange its pending credential (recoverAdmission). */
export const ADMISSION_RECOVERY_MS = 10 * 60_000;

/** Create a one-time invitation for slot 1; older unconsumed invitations for the slot are closed. */
export async function createInvitation(
  db: Kysely<DB>,
  sessionId: string,
  publicOrigin: string,
  now = new Date(),
) {
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const inv = await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('camera_invitations')
      .set({ consumed_at: now })
      .where('session_id', '=', sessionId)
      .where('slot', '=', 1)
      .where('consumed_at', 'is', null)
      .execute();
    return trx
      .insertInto('camera_invitations')
      .values({ session_id: sessionId, token_hash: sha256(token), expires_at: expiresAt })
      .returning(['id'])
      .executeTakeFirstOrThrow();
  });
  // Secret in the URL fragment: never sent to servers by scanners or link previews (PAIR-02).
  return {
    invitationId: inv.id,
    url: `${publicOrigin}/cam#t=${token}`,
    expiresAt: expiresAt.toISOString(),
  };
}

async function findUsableInvitation(db: Kysely<DB>, token: string, now: Date) {
  const inv = await db
    .selectFrom('camera_invitations')
    .innerJoin('stream_sessions as s', 's.id', 'camera_invitations.session_id')
    .select([
      'camera_invitations.id',
      'camera_invitations.session_id',
      'camera_invitations.slot',
      's.name',
      's.operator_name',
      's.lifecycle',
    ])
    .where('token_hash', '=', sha256(token))
    .where('consumed_at', 'is', null)
    .where('expires_at', '>', now)
    .executeTakeFirst();
  if (!inv || inv.lifecycle === 'ENDED' || inv.lifecycle === 'INTERRUPTED')
    throw new AppError('PAIR_INVALID', 'camera');
  return inv;
}

/** PAIR-03: preview does not consume the invitation. */
export async function previewInvitation(db: Kysely<DB>, token: string, now = new Date()) {
  const inv = await findUsableInvitation(db, token, now);
  return { serviceName: inv.name, operatorName: inv.operator_name };
}

export function deviceHintFromUserAgent(ua: string | undefined): string {
  if (!ua) return '';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Unknown device';
  const br = /SamsungBrowser/.test(ua)
    ? 'Samsung Internet'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'browser';
  return `${os} · ${br}`;
}

/**
 * Atomic claim (PAIR-03, A04): consuming the invitation and inserting the pending source happen in one
 * transaction; a concurrent second claim finds the invitation consumed and fails with PAIR_INVALID.
 */
export async function claimInvitation(
  db: Kysely<DB>,
  input: { token: string; deviceId: string; label: string; userAgent?: string },
  now = new Date(),
) {
  const credential = randomToken(32);
  const phrase = verificationPhrase();
  return db.transaction().execute(async (trx) => {
    const inv = await trx
      .updateTable('camera_invitations')
      .set({ consumed_at: now })
      .where('token_hash', '=', sha256(input.token))
      .where('consumed_at', 'is', null)
      .where('expires_at', '>', now)
      .returning(['id', 'session_id', 'slot'])
      .executeTakeFirst();
    if (!inv) throw new AppError('PAIR_INVALID', 'camera');
    // The same phone scanning a fresh code takes its own slot back (its page was closed, the browser
    // was cleared, or the credential expired while it was away). The code on the studio screen proves
    // the operator is offering it; a different phone still needs the slot freed first (B§8.3).
    const held = await trx
      .selectFrom('camera_sources')
      .select(['id', 'status', 'device_fingerprint', 'verification_phrase'])
      .where('session_id', '=', inv.session_id)
      .where('slot', '=', inv.slot)
      .where('status', 'in', ['pending', 'admitted'])
      .executeTakeFirst();
    if (held) {
      if (!held.device_fingerprint.equals(sha256(input.deviceId)))
        throw new AppError('PAIR_SLOT_TAKEN', 'camera');
      await trx
        .updateTable('camera_sources')
        .set({
          credential_hash: sha256(credential),
          credential_expires_at: new Date(now.getTime() + CONTRIBUTOR_TTL_MS),
          pending_credential_hash: null,
          pending_valid_until: null,
        })
        .where('id', '=', held.id)
        .execute();
      return {
        sourceId: held.id,
        sessionId: inv.session_id,
        verificationPhrase: held.verification_phrase,
        credential,
        reclaimed: held.status === 'admitted',
      };
    }
    try {
      const src = await trx
        .insertInto('camera_sources')
        .values({
          session_id: inv.session_id,
          invitation_id: inv.id,
          slot: inv.slot,
          label: input.label,
          verification_phrase: phrase,
          device_hint: deviceHintFromUserAgent(input.userAgent),
          device_fingerprint: sha256(input.deviceId),
          status: 'pending',
          credential_hash: sha256(credential),
          credential_expires_at: new Date(now.getTime() + CONTRIBUTOR_TTL_MS),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      return {
        sourceId: src.id,
        sessionId: inv.session_id,
        verificationPhrase: phrase,
        credential,
        reclaimed: false,
      };
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new AppError('PAIR_SLOT_TAKEN', 'camera');
      throw e;
    }
  });
}

export async function sourceByCredential(db: Kysely<DB>, credential: string, now = new Date()) {
  const src = await db
    .selectFrom('camera_sources')
    .innerJoin('stream_sessions as s', 's.id', 'camera_sources.session_id')
    .select([
      'camera_sources.id',
      'camera_sources.session_id',
      'camera_sources.status',
      'camera_sources.label',
      's.name as service_name',
      's.generation',
    ])
    .where('credential_hash', '=', sha256(credential))
    .where('credential_expires_at', '>', now)
    .where('camera_sources.status', 'in', ['pending', 'admitted'])
    .executeTakeFirst();
  return src ?? null;
}

/** Admission issues a fresh contributor credential (invitations and credentials are different objects). */
export async function admitSource(
  db: Kysely<DB>,
  sessionId: string,
  sourceId: string,
  now = new Date(),
) {
  const credential = randomToken(32);
  const expiresAt = new Date(now.getTime() + CONTRIBUTOR_TTL_MS);
  const r = await db
    .updateTable('camera_sources')
    .set((eb) => ({
      status: 'admitted',
      admitted_at: now,
      credential_hash: sha256(credential),
      credential_expires_at: expiresAt,
      // The phone may miss the "admitted" message (screen locked, tab in the background, proxy
      // dropped the socket); let its pending credential be exchanged once, shortly (recoverAdmission).
      pending_credential_hash: eb.ref('credential_hash'),
      pending_valid_until: new Date(now.getTime() + ADMISSION_RECOVERY_MS),
    }))
    .where('id', '=', sourceId)
    .where('session_id', '=', sessionId)
    .where('status', '=', 'pending')
    .returning(['id'])
    .executeTakeFirst();
  if (!r) throw new AppError('NOT_FOUND', 'camera');
  return { credential, expiresAt: expiresAt.toISOString() };
}

/**
 * Exchange a just-admitted phone's pending credential for a fresh contributor credential, once and only
 * within the recovery window. Atomic, so two racing reconnects cannot both succeed.
 */
export async function recoverAdmission(
  db: Kysely<DB>,
  pendingCredential: string,
  now = new Date(),
) {
  const credential = randomToken(32);
  const expiresAt = new Date(now.getTime() + CONTRIBUTOR_TTL_MS);
  const r = await db
    .updateTable('camera_sources')
    .set({
      credential_hash: sha256(credential),
      credential_expires_at: expiresAt,
      pending_credential_hash: null,
      pending_valid_until: null,
    })
    .where('pending_credential_hash', '=', sha256(pendingCredential))
    .where('pending_valid_until', '>', now)
    .where('status', '=', 'admitted')
    .returning(['id'])
    .executeTakeFirst();
  return r ? { credential, expiresAt: expiresAt.toISOString() } : null;
}

/** The phone connected with its contributor credential: the pending one is no longer needed. */
export async function forgetPendingCredential(db: Kysely<DB>, sourceId: string): Promise<void> {
  await db
    .updateTable('camera_sources')
    .set({ pending_credential_hash: null, pending_valid_until: null })
    .where('id', '=', sourceId)
    .where('pending_credential_hash', 'is not', null)
    .execute();
}

/** Renew an admitted contributor credential in place (rotated secret). */
export async function renewCredential(db: Kysely<DB>, sourceId: string, now = new Date()) {
  const credential = randomToken(32);
  const expiresAt = new Date(now.getTime() + CONTRIBUTOR_TTL_MS);
  const r = await db
    .updateTable('camera_sources')
    .set({ credential_hash: sha256(credential), credential_expires_at: expiresAt })
    .where('id', '=', sourceId)
    .where('status', '=', 'admitted')
    .returning(['id'])
    .executeTakeFirst();
  return r ? { credential, expiresAt: expiresAt.toISOString() } : null;
}

export async function rejectSource(db: Kysely<DB>, sessionId: string, sourceId: string) {
  const r = await db
    .updateTable('camera_sources')
    .set({ status: 'rejected', revoked_at: new Date() })
    .where('id', '=', sourceId)
    .where('session_id', '=', sessionId)
    .where('status', '=', 'pending')
    .returning(['id'])
    .executeTakeFirst();
  if (!r) throw new AppError('NOT_FOUND', 'camera');
}

export async function revokeSource(db: Kysely<DB>, sessionId: string, sourceId: string) {
  const r = await db
    .updateTable('camera_sources')
    .set({ status: 'revoked', revoked_at: new Date() })
    .where('id', '=', sourceId)
    .where('session_id', '=', sessionId)
    .where('status', 'in', ['pending', 'admitted'])
    .returning(['id'])
    .executeTakeFirst();
  if (!r) throw new AppError('NOT_FOUND', 'camera');
}

export async function renameSource(
  db: Kysely<DB>,
  sessionId: string,
  sourceId: string,
  label: string,
) {
  await db
    .updateTable('camera_sources')
    .set({ label })
    .where('id', '=', sourceId)
    .where('session_id', '=', sessionId)
    .execute();
}
