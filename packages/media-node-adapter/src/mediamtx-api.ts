/** Minimal MediaMTX v3 API client (config paths + path state). */
export interface PathInfo {
  name: string;
  ready: boolean;
  tracks: string[];
  bytesReceived: number;
  readers: Array<{ type: string; id: string }>;
  source: { type: string; id: string } | null;
}

export class MediaMtxApi {
  constructor(
    private readonly base: string,
    private readonly user: string,
    private readonly pass: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async req(method: string, path: string, body?: unknown): Promise<Response> {
    return this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${this.user}:${this.pass}`).toString('base64'),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3000),
    });
  }

  async getPath(name: string): Promise<PathInfo | null> {
    const r = await this.req('GET', `/v3/paths/get/${name}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`mediamtx api ${r.status}`);
    return (await r.json()) as PathInfo;
  }

  /** Configuration survives an idle producer, but must be restored after a MediaMTX restart. */
  async hasPathConfig(name: string): Promise<boolean> {
    const r = await this.req('GET', `/v3/config/paths/get/${name}`);
    if (r.status === 404) return false;
    if (!r.ok) throw new Error(`mediamtx path config ${r.status}`);
    return true;
  }

  /** Add or replace a path configuration. */
  async upsertPathConfig(name: string, conf: Record<string, unknown>): Promise<void> {
    let r = await this.req('POST', `/v3/config/paths/add/${name}`, conf);
    if (r.status === 400) r = await this.req('POST', `/v3/config/paths/replace/${name}`, conf);
    if (!r.ok) throw new Error(`mediamtx path config ${r.status}: ${await r.text()}`);
  }

  async deletePathConfig(name: string): Promise<void> {
    const r = await this.req('DELETE', `/v3/config/paths/delete/${name}`);
    if (!r.ok && r.status !== 404) throw new Error(`mediamtx path delete ${r.status}`);
  }
}
