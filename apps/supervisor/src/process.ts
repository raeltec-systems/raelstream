import { spawn, type ChildProcess } from 'node:child_process';
import { ProgressParser, redact, type Progress } from '@raelstream/media-node-adapter';

export type Role = 'normaliser' | 'publisher' | 'slate';

export interface ProcessSnapshot {
  pid: number | null;
  startedAt: number;
  lastProgress: Progress | null;
  /** Last time out_time advanced (normaliser stall detection). */
  lastTimeAdvanceAt: number;
  /** Last time total_size advanced (publisher stall detection). */
  lastSizeAdvanceAt: number;
  exited: boolean;
  exitCode: number | null;
}

const STDERR_TAIL = 8192;

/**
 * One supervised FFmpeg process: argument array only, minimal environment, progress on fd 3,
 * redacted stderr tail for classification (never logged raw).
 */
export class ManagedProcess {
  private child: ChildProcess;
  private stderrTail = '';
  private exitResolvers: Array<() => void> = [];
  readonly snapshot: ProcessSnapshot;

  constructor(
    readonly role: Role,
    readonly key: string,
    readonly generation: number,
    ffmpegPath: string,
    args: string[],
    private readonly secrets: string[],
    private readonly onExit: (p: ManagedProcess) => void,
    now = Date.now(),
  ) {
    this.snapshot = {
      pid: null,
      startedAt: now,
      lastProgress: null,
      lastTimeAdvanceAt: now,
      lastSizeAdvanceAt: now,
      exited: false,
      exitCode: null,
    };
    this.child = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    });
    this.snapshot.pid = this.child.pid ?? null;
    const parser = new ProgressParser((p) => this.onProgress(p));
    const fd3 = this.child.stdio[3];
    fd3?.on('data', (d: Buffer) => parser.push(d.toString('utf8')));
    this.child.stderr?.on('data', (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString('utf8')).slice(-STDERR_TAIL);
    });
    this.child.on('exit', (code) => {
      this.snapshot.exited = true;
      this.snapshot.exitCode = code;
      for (const r of this.exitResolvers.splice(0)) r();
      this.onExit(this);
    });
    this.child.on('error', () => {
      this.snapshot.exited = true;
      for (const r of this.exitResolvers.splice(0)) r();
      this.onExit(this);
    });
  }

  private onProgress(p: Progress): void {
    const now = Date.now();
    const prev = this.snapshot.lastProgress;
    if (p.outTimeUs !== null && (prev?.outTimeUs == null || p.outTimeUs > prev.outTimeUs))
      this.snapshot.lastTimeAdvanceAt = now;
    if (p.totalSize !== null && (prev?.totalSize == null || p.totalSize > prev.totalSize))
      this.snapshot.lastSizeAdvanceAt = now;
    this.snapshot.lastProgress = p;
  }

  /** Redacted stderr, safe to classify and store. */
  get stderr(): string {
    return redact(this.stderrTail, this.secrets);
  }

  /** SIGTERM, then SIGKILL after `graceMs`. Resolves when the process has exited. */
  stop(graceMs = 1500): Promise<void> {
    if (this.snapshot.exited) return Promise.resolve();
    const done = new Promise<void>((r) => this.exitResolvers.push(r));
    this.child.kill('SIGTERM');
    const t = setTimeout(() => {
      if (!this.snapshot.exited) this.child.kill('SIGKILL');
    }, graceMs);
    return done.finally(() => clearTimeout(t));
  }
}

/** Run a short-lived FFmpeg job (slate rendering) and resolve with its exit code. */
export function runOnce(
  ffmpegPath: string,
  args: string[],
  timeoutMs = 60_000,
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const c = spawn(ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    });
    let err = '';
    c.stderr?.on('data', (d: Buffer) => {
      err = (err + d.toString('utf8')).slice(-4096);
    });
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs);
    c.on('exit', (code) => {
      clearTimeout(t);
      resolve({ code, stderr: redact(err) });
    });
    c.on('error', () => {
      clearTimeout(t);
      resolve({ code: -1, stderr: 'spawn failed' });
    });
  });
}
