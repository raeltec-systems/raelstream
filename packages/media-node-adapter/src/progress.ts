/** Parser for FFmpeg `-progress` output: key=value lines, each block ends with `progress=continue|end`. */
export interface Progress {
  outTimeUs: number | null;
  totalSize: number | null;
  fps: number | null;
  speed: number | null;
  bitrateKbps: number | null;
  frame: number | null;
  end: boolean;
}

export class ProgressParser {
  private buf = '';
  private cur: Record<string, string> = {};
  constructor(private readonly onBlock: (p: Progress) => void) {}

  push(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const k = line.slice(0, eq);
      const v = line.slice(eq + 1).trim();
      this.cur[k] = v;
      if (k === 'progress') {
        this.onBlock(parseBlock(this.cur));
        this.cur = {};
      }
    }
    if (this.buf.length > 4096) this.buf = this.buf.slice(-1024);
  }
}

function n(v: string | undefined): number | null {
  if (v === undefined || v === 'N/A') return null;
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : null;
}

export function parseBlock(b: Record<string, string>): Progress {
  return {
    outTimeUs: n(b.out_time_us ?? b.out_time_ms),
    totalSize: n(b.total_size),
    fps: n(b.fps),
    speed: n(b.speed?.replace(/x$/, '')),
    bitrateKbps: n(b.bitrate?.replace(/kbits\/s$/, '')),
    frame: n(b.frame),
    end: b.progress === 'end',
  };
}
