import { randomBytes } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import {
  DesiredState,
  type DestinationFailure,
  type DestinationState,
  type ObservedState,
} from '@raelstream/contracts';
import {
  DestinationError,
  MediaMtxApi,
  PROFILES,
  assertPublicHost,
  backoffMs,
  classifyPublisherError,
  isRetryable,
  normaliserArgs,
  publishUrl,
  publisherArgs,
  validateServerUrl,
  type Platform,
} from '@raelstream/media-node-adapter';
import { open } from '@raelstream/secrets';
import type { SupervisorConfig } from './config.js';
import type { SupervisorDB } from './db.js';
import { deriveLiveLifecycle, emptyObserved } from './lifecycle.js';
import { ManagedProcess } from './process.js';
import { ensureSlate } from './slate.js';

/** Contribution must be present with both tracks this long before the normaliser (re)starts. */
export const CONTRIB_SETTLE_MS = 2000;
/** Normaliser output not advancing this long = stalled (SPEC §12.3). */
export const NORMALISER_STALL_MS = 3000;
export const NORMALISER_STARTUP_MS = 8000;
/** Publisher size not advancing this long = stalled (SPEC §12.4). */
export const PUBLISHER_STALL_MS = 10_000;
export const PUBLISHER_SENDING_AFTER_MS = 3000;
const ATTEMPTS_RESET_AFTER_MS = 30_000;

interface Pub {
  proc: ManagedProcess | null;
  state: DestinationState;
  since: number;
  attempts: number;
  nextAttemptAt: number;
  failure: DestinationFailure | null;
  retryNonce: number;
  sendingSince: number | null;
  stopping: boolean;
}

type Log = (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => void;

/**
 * Reconciles the desired media state in PostgreSQL with running FFmpeg processes and MediaMTX paths
 * (SPEC §12). Stop always wins; every process is tagged with its generation; one destination's failure
 * never touches another destination's process.
 */
export class Supervisor {
  private sessionId: string | null = null;
  private generation = 0;
  private normPath: string | null = null;
  private slateFile: string | null = null;
  private normaliser: ManagedProcess | null = null;
  private normaliserEverRan = false;
  private contribPresentSince: number | null = null;
  private fallbackSince: number | null = null;
  private pubs = new Map<string, Pub>();
  private observed: ObservedState = emptyObserved(0, new Date().toISOString());
  private lastWrite = 0;
  private lastWrittenJson = '';
  private running = false;
  private readonly mtx: MediaMtxApi;

  constructor(
    private readonly cfg: SupervisorConfig,
    private readonly db: Kysely<SupervisorDB>,
    private readonly log: Log,
    mtx?: MediaMtxApi,
  ) {
    this.mtx = mtx ?? new MediaMtxApi(cfg.mediamtxApi, cfg.internalUser, cfg.internalPass);
  }

  /** MediaMTX RTMP auth uses query parameters. */
  private rtmp(path: string): string {
    const u = new URL(`${this.cfg.mediamtxRtmp}/${path}`);
    u.searchParams.set('user', this.cfg.internalUser);
    u.searchParams.set('pass', this.cfg.internalPass);
    return u.toString();
  }

  private rtsp(path: string): string {
    const u = new URL(`${this.cfg.mediamtxRtsp}/${path}`);
    u.username = this.cfg.internalUser;
    u.password = this.cfg.internalPass;
    return u.toString();
  }

  /** One reconciliation pass. Re-entrant calls are skipped. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.reconcile();
    } catch (e) {
      this.log('error', 'reconcile failed', { err: (e as Error).message });
    } finally {
      this.running = false;
    }
  }

  async shutdown(): Promise<void> {
    await this.stopAll();
  }

  private async reconcile(): Promise<void> {
    const now = Date.now();
    const row = await this.db
      .selectFrom('stream_sessions')
      .selectAll()
      .where('lifecycle', 'not in', ['ENDED', 'INTERRUPTED'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
    const parsed = row ? DesiredState.safeParse(row.desired_state) : null;
    if (!row || !parsed?.success) {
      if (this.sessionId) await this.resetSession();
      return;
    }
    const desired = parsed.data;
    if (row.id !== this.sessionId) {
      await this.resetSession();
      this.sessionId = row.id;
      this.generation = desired.generation;
      this.observed = emptyObserved(desired.generation, new Date(now).toISOString());
    } else if (desired.generation !== this.generation) {
      // Studio takeover (A33, E37): only the contribution path changes. Stop the normaliser reading the
      // old generation; publishers and the normalised path stay up, so viewers see the slate for the gap
      // instead of the platforms being disconnected.
      this.log('info', 'studio takeover; switching contribution generation', {
        from: this.generation,
        to: desired.generation,
      });
      const n = this.normaliser;
      this.normaliser = null;
      await n?.stop(800);
      this.generation = desired.generation;
      this.observed.generation = desired.generation;
      this.contribPresentSince = null;
    }

    if (desired.stopRequestedAt) {
      await this.completeStop(row.id, desired);
      return;
    }
    if (desired.normaliser !== 'running') return;

    await this.ensureNormPath(row.id, row.name, desired);
    await this.syncRecording(desired).catch((e) =>
      this.log('warn', 'recording change failed', { err: (e as Error).message }),
    );
    await this.reconcileContribution(row.id, desired, now);
    if (desired.mode === 'live') {
      await this.reconcileFallback(row.id, desired, now);
      if (this.sessionId !== row.id) return; // interrupted
      await this.reconcilePublishers(desired, now);
      const lifecycle = deriveLiveLifecycle(desired, this.observed, row.lifecycle);
      if (lifecycle !== row.lifecycle) {
        await this.db
          .updateTable('stream_sessions')
          .set({ lifecycle })
          .where('id', '=', row.id)
          .where('lifecycle', 'not in', ['STOPPING', 'ENDED', 'INTERRUPTED'])
          .execute();
        this.log('info', 'lifecycle', { from: row.lifecycle, to: lifecycle });
      }
    }
    await this.writeObserved(row.id, now);
  }

  private slateRetryAt = 0;
  private normCheckAt = 0;

  private async ensureNormPath(
    sessionId: string,
    name: string,
    desired: DesiredState,
  ): Promise<void> {
    if (this.normPath) {
      if (Date.now() < this.normCheckAt) return;
      this.normCheckAt = Date.now() + 2000;
      if (!(await this.mtx.hasPathConfig(this.normPath))) {
        // API-created paths are lost when MediaMTX restarts. Keep the same path so existing
        // normaliser/publisher retries recover, including the slate and private recording.
        await this.mtx.upsertPathConfig(this.normPath, this.normPathConfig(!!desired.record));
        this.recording = !!desired.record;
        this.log('warn', 'restored normalised path after media server restart');
      }
      return;
    }
    if (Date.now() < this.slateRetryAt) return;
    this.slateRetryAt = Date.now() + 5000; // bounded retry if rendering fails
    this.slateFile = await ensureSlate(this.cfg.ffmpegPath, this.cfg.slateDir, this.cfg.slateFont, {
      profile: desired.profile,
      text: "We'll be right back",
      subtext: name,
      background: '#161A18',
      accent: '#2F6FCF',
    });
    // Unguessable internal path; never exposed publicly (B§5.3).
    const path = `norm/${sessionId}/${randomBytes(16).toString('hex')}`;
    await this.mtx.upsertPathConfig(path, this.normPathConfig(!!desired.record));
    this.recording = !!desired.record;
    this.normPath = path;
    this.slateRetryAt = 0;
    this.log('info', 'normalised path ready', { profile: desired.profile });
  }

  private recording = false;

  /**
   * The public output's path. Recording (SPEC §12.7) is MediaMTX's own path recording: the normalised
   * output including slate periods, in 10-minute fMP4 segments on the recordings volume.
   */
  private normPathConfig(record: boolean): Record<string, unknown> {
    return {
      source: 'publisher',
      alwaysAvailable: true,
      alwaysAvailableFile: this.slateFile,
      record,
      ...(record
        ? {
            recordPath: `${this.cfg.recordingsDir}/%path/%Y-%m-%d_%H-%M-%S-%f`,
            recordFormat: 'fmp4',
            recordSegmentDuration: '10m',
          }
        : {}),
    };
  }

  /** A private test becoming a recorded broadcast turns recording on without a new path. */
  private async syncRecording(desired: DesiredState): Promise<void> {
    const want = !!desired.record && !desired.stopRequestedAt;
    if (!this.normPath || want === this.recording) return;
    await this.mtx.upsertPathConfig(this.normPath, this.normPathConfig(want));
    this.recording = want;
    this.log('info', want ? 'recording started' : 'recording stopped');
  }

  private async reconcileContribution(
    sessionId: string,
    desired: DesiredState,
    now: number,
  ): Promise<void> {
    const contribPath = `live/${sessionId}/g${desired.generation}/contrib`;
    const info = await this.mtx.getPath(contribPath).catch(() => null);
    const present = !!info?.ready && (info.tracks?.length ?? 0) >= 2;
    const iso = new Date(now).toISOString();
    if (present) this.contribPresentSince ??= now;
    else this.contribPresentSince = null;
    const cstate = present ? 'present' : this.normaliserEverRan ? 'lost' : 'absent';
    if (this.observed.contribution.state !== cstate)
      this.observed.contribution = { state: cstate, since: iso, tracks: info?.tracks ?? [] };
    else this.observed.contribution.tracks = info?.tracks ?? [];

    const n = this.normaliser;
    if (n && !n.snapshot.exited) {
      const up = now - n.snapshot.startedAt;
      const advancing = now - n.snapshot.lastTimeAdvanceAt < NORMALISER_STALL_MS;
      const hasOutput = (n.snapshot.lastProgress?.outTimeUs ?? 0) > 0;
      if (hasOutput && advancing) {
        if (!this.normaliserEverRan) this.log('info', 'normaliser producing output');
        this.normaliserEverRan = true;
        this.setNormaliser('running', iso, n);
      }
      const stalled = hasOutput ? !advancing : up > NORMALISER_STARTUP_MS;
      if (!present || stalled) {
        this.log('warn', 'contribution lost; stopping normaliser', { present, stalled });
        this.normaliser = null;
        await n.stop(800);
        this.setNormaliser(this.normaliserEverRan ? 'stalled' : 'waiting', iso, null);
      }
      return;
    }
    if (
      present &&
      this.contribPresentSince !== null &&
      now - this.contribPresentSince >= CONTRIB_SETTLE_MS &&
      this.normPath
    ) {
      const p = PROFILES[desired.profile];
      this.normaliser = new ManagedProcess(
        'normaliser',
        'normaliser',
        desired.generation,
        this.cfg.ffmpegPath,
        normaliserArgs(p, this.rtsp(contribPath), this.rtmp(this.normPath)),
        [this.cfg.internalPass],
        (proc) => {
          if (this.normaliser === proc) {
            this.normaliser = null;
            this.log('warn', 'normaliser exited', {
              code: proc.snapshot.exitCode,
              stderr: proc.stderr.slice(-300),
            });
          }
        },
      );
      this.setNormaliser('waiting', iso, null);
      this.log('info', 'normaliser started', { profile: desired.profile });
    } else if (!this.normaliser) {
      this.setNormaliser(this.normaliserEverRan ? 'stalled' : 'waiting', iso, null);
    }
  }

  private setNormaliser(
    state: ObservedState['normaliser']['state'],
    iso: string,
    p: ManagedProcess | null,
  ): void {
    const prog = p?.snapshot.lastProgress;
    const since = this.observed.normaliser.state === state ? this.observed.normaliser.since : iso;
    this.observed.normaliser = { state, since, speed: prog?.speed ?? null, fps: prog?.fps ?? null };
  }

  /** Fallback slate + bounded grace (SPEC §12.5, B§15.5). */
  private async reconcileFallback(
    sessionId: string,
    desired: DesiredState,
    now: number,
  ): Promise<void> {
    const onSlate = this.normaliserEverRan && this.observed.normaliser.state !== 'running';
    if (onSlate) {
      this.fallbackSince ??= now;
      const ends = this.fallbackSince + desired.fallbackGraceS * 1000;
      this.observed.fallback = {
        active: true,
        since: new Date(this.fallbackSince).toISOString(),
        graceEndsAt: new Date(ends).toISOString(),
      };
      if (now >= ends) {
        this.log('warn', 'fallback grace expired; interrupting session');
        await this.stopAll();
        const iso = new Date(now).toISOString();
        for (const [id, p] of this.pubs) this.observed.destinations[id] = this.obsDest(p, iso);
        await this.db.transaction().execute(async (trx) => {
          await trx
            .updateTable('stream_sessions')
            .set({
              lifecycle: 'INTERRUPTED',
              ended_at: new Date(now),
              end_reason: 'contribution_lost',
            })
            .where('id', '=', sessionId)
            .execute();
          await trx
            .updateTable('ingest_tokens')
            .set({ revoked_at: new Date(now) })
            .where('session_id', '=', sessionId)
            .where('revoked_at', 'is', null)
            .execute();
        });
        await this.writeObserved(sessionId, now, true);
        await this.resetSession();
      }
    } else if (this.fallbackSince !== null) {
      this.log('info', 'programme restored; fallback off');
      this.fallbackSince = null;
      this.observed.fallback = { active: false, since: null, graceEndsAt: null };
    }
  }

  private async reconcilePublishers(desired: DesiredState, now: number): Promise<void> {
    const iso = new Date(now).toISOString();
    for (const [id, want] of Object.entries(desired.publishers)) {
      let p = this.pubs.get(id);
      if (!p) {
        p = {
          proc: null,
          state: 'CONNECTING',
          since: now,
          attempts: 0,
          nextAttemptAt: 0,
          failure: null,
          retryNonce: want.retryNonce,
          sendingSince: null,
          stopping: false,
        };
        this.pubs.set(id, p);
      }
      if (want.state === 'stopped') {
        if (p.proc) {
          p.stopping = true;
          await p.proc.stop();
        }
        this.setPub(p, 'STOPPED', now);
      } else {
        if (want.retryNonce !== p.retryNonce) {
          // Operator retry: only this destination (B§21.1 retry route).
          p.retryNonce = want.retryNonce;
          p.attempts = 0;
          p.failure = null;
          p.nextAttemptAt = 0;
          if (p.state === 'FAILED') this.setPub(p, 'CONNECTING', now);
        }
        await this.reconcileOnePublisher(id, p, now);
      }
      this.observed.destinations[id] = this.obsDest(p, iso);
    }
    for (const [id, p] of this.pubs) {
      if (!(id in desired.publishers) && p.proc) {
        p.stopping = true;
        await p.proc.stop();
        this.setPub(p, 'STOPPED', now);
        this.observed.destinations[id] = this.obsDest(p, iso);
      }
    }
  }

  private async reconcileOnePublisher(id: string, p: Pub, now: number): Promise<void> {
    const proc = p.proc;
    if (proc && !proc.snapshot.exited) {
      const up = now - proc.snapshot.startedAt;
      const sizeFresh =
        now - proc.snapshot.lastSizeAdvanceAt < 2000 &&
        (proc.snapshot.lastProgress?.totalSize ?? 0) > 0;
      if (up >= PUBLISHER_SENDING_AFTER_MS && sizeFresh && p.state !== 'SENDING') {
        this.setPub(p, 'SENDING', now);
        p.sendingSince = now;
      }
      if (p.state === 'SENDING' && p.sendingSince && now - p.sendingSince > ATTEMPTS_RESET_AFTER_MS)
        p.attempts = 0;
      if (up > PUBLISHER_STALL_MS && now - proc.snapshot.lastSizeAdvanceAt > PUBLISHER_STALL_MS) {
        this.log('warn', 'publisher stalled; restarting', { destination: id });
        await proc.stop(500); // exit handler schedules the retry
      }
      return;
    }
    if (p.failure && !isRetryable(p.failure as never)) return;
    // Publishers start only after real programme output exists, so viewers never get the slate first.
    if (!this.normaliserEverRan || !this.normPath) return;
    if (now < p.nextAttemptAt) return;
    await this.spawnPublisher(id, p, now);
  }

  private async spawnPublisher(id: string, p: Pub, now: number): Promise<void> {
    const dest = await this.db
      .selectFrom('destinations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!dest || !dest.enabled) return this.failPub(p, 'DEST_URL_NOT_ALLOWED', now);
    // A per-event destination (Facebook, I-13) uses the key pasted for this service only.
    const keyEnc =
      dest.key_mode === 'per_event'
        ? ((
            await this.db
              .selectFrom('session_destinations')
              .select('session_key_enc')
              .where('session_id', '=', this.sessionId ?? '')
              .where('destination_id', '=', id)
              .executeTakeFirst()
          )?.session_key_enc ?? null)
        : dest.key_enc;
    if (!keyEnc) return this.failPub(p, 'DEST_KEY_MISSING', now);
    let target: string;
    let key: string;
    try {
      const url = validateServerUrl(
        dest.platform as Platform,
        dest.server_url,
        undefined,
        this.cfg.testSinks,
      );
      await assertPublicHost(url, this.cfg.testSinks);
      key = await open(
        { publicKey: this.cfg.sealPublicKey, secretKey: this.cfg.sealSecretKey },
        keyEnc,
      );
      target = publishUrl(dest.server_url, key);
    } catch (e) {
      return this.failPub(
        p,
        e instanceof DestinationError
          ? e.code === 'DEST_KEY_INVALID'
            ? 'DEST_KEY_MISSING'
            : e.code
          : 'DEST_KEY_MISSING',
        now,
      );
    }
    this.setPub(p, p.attempts > 0 ? 'RECONNECTING' : 'CONNECTING', now);
    p.sendingSince = null;
    p.stopping = false;
    const proc = new ManagedProcess(
      'publisher',
      id,
      this.generation,
      this.cfg.ffmpegPath,
      publisherArgs(this.rtmp(this.normPath!), target),
      [key, this.cfg.internalPass],
      (exited) => this.onPublisherExit(id, exited),
    );
    p.proc = proc;
    this.log('info', 'publisher started', {
      destination: id,
      platform: dest.platform,
      attempt: p.attempts,
    });
  }

  private onPublisherExit(id: string, proc: ManagedProcess): void {
    const p = this.pubs.get(id);
    if (!p || p.proc !== proc) return;
    p.proc = null;
    const now = Date.now();
    if (p.stopping) {
      this.setPub(p, 'STOPPED', now);
      return;
    }
    const failure = classifyPublisherError(proc.stderr);
    this.log('warn', 'publisher exited', {
      destination: id,
      code: proc.snapshot.exitCode,
      failure,
      stderr: proc.stderr.slice(-300),
    });
    if (!isRetryable(failure)) return this.failPub(p, failure, now);
    p.nextAttemptAt = now + backoffMs(p.attempts);
    p.attempts += 1;
    p.failure = failure;
    this.setPub(p, 'RECONNECTING', now);
  }

  private failPub(p: Pub, failure: DestinationFailure, now: number): void {
    p.failure = failure;
    this.setPub(p, 'FAILED', now);
  }

  private setPub(p: Pub, state: DestinationState, now: number): void {
    if (p.state !== state) {
      p.state = state;
      p.since = now;
      if (state !== 'SENDING') p.sendingSince = null;
    }
  }

  private obsDest(p: Pub, _iso: string) {
    return {
      state: p.state,
      since: new Date(p.since).toISOString(),
      attempts: p.attempts,
      failure: p.state === 'SENDING' ? null : p.failure,
      bitrateKbps: p.proc?.snapshot.lastProgress?.bitrateKbps ?? null,
      sendingSince: p.sendingSince ? new Date(p.sendingSince).toISOString() : null,
    };
  }

  private async writeObserved(sessionId: string, now: number, force = false): Promise<void> {
    const { updatedAt: _u, ...rest } = this.observed;
    const json = JSON.stringify(rest);
    if (!force && json === this.lastWrittenJson && now - this.lastWrite < 2000) return;
    this.observed.updatedAt = new Date(now).toISOString();
    this.lastWrittenJson = json;
    this.lastWrite = now;
    await this.db
      .updateTable('stream_sessions')
      .set({ observed_state: JSON.stringify(this.observed) })
      .where('id', '=', sessionId)
      .execute();
    await sql`select pg_notify('observed_changed', ${sessionId})`.execute(this.db);
  }

  /** Stop wins over everything (A34). */
  private async completeStop(sessionId: string, desired: DesiredState): Promise<void> {
    await this.stopAll();
    const now = Date.now();
    const iso = new Date(now).toISOString();
    for (const [id, p] of this.pubs) {
      this.setPub(p, 'STOPPED', now);
      this.observed.destinations[id] = this.obsDest(p, iso);
    }
    this.setNormaliser('stopped', iso, null);
    this.observed.fallback = { active: false, since: null, graceEndsAt: null };
    await this.writeObserved(sessionId, now, true);
    await this.db.transaction().execute(async (trx) => {
      if (desired.endOnStop) {
        await trx
          .updateTable('stream_sessions')
          .set({ lifecycle: 'ENDED', ended_at: new Date(now), end_reason: 'operator' })
          .where('id', '=', sessionId)
          .execute();
        await trx
          .updateTable('ingest_tokens')
          .set({ revoked_at: new Date(now) })
          .where('session_id', '=', sessionId)
          .where('revoked_at', 'is', null)
          .execute();
      } else {
        // Private test finished: back to preparation. Guarded so a newer desired state is never clobbered.
        await trx
          .updateTable('stream_sessions')
          .set({ lifecycle: 'PREPARING', desired_state: '{}' })
          .where('id', '=', sessionId)
          .where(sql`desired_state->>'stopRequestedAt'`, '=', desired.stopRequestedAt)
          .execute();
      }
    });
    await sql`select pg_notify('observed_changed', ${sessionId})`.execute(this.db);
    this.log('info', 'stop complete', { endOnStop: desired.endOnStop });
    await this.resetSession();
  }

  private async stopAll(): Promise<void> {
    const stops: Promise<void>[] = [];
    for (const p of this.pubs.values()) {
      if (p.proc) {
        p.stopping = true;
        stops.push(p.proc.stop());
      }
    }
    if (this.normaliser) stops.push(this.normaliser.stop());
    this.normaliser = null;
    await Promise.all(stops);
    if (this.normPath) {
      await this.mtx.deletePathConfig(this.normPath).catch(() => undefined);
      this.normPath = null;
    }
  }

  private async resetSession(): Promise<void> {
    await this.stopAll();
    this.sessionId = null;
    this.generation = 0;
    this.pubs.clear();
    this.normaliserEverRan = false;
    this.contribPresentSince = null;
    this.fallbackSince = null;
    this.normCheckAt = 0;
    this.slateRetryAt = 0;
    this.lastWrittenJson = '';
  }
}
