import type { ApiError } from '@raelstream/contracts';

let csrf = '';

/**
 * Studio tab identity for the lease (SPEC §8.4). Kept in sessionStorage so a reload of the holding tab
 * reclaims its own lease, while a second tab gets a new identity and opens read-only.
 */
export const clientId: string = (() => {
  try {
    const existing = sessionStorage.getItem('rs.client');
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem('rs.client', id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
})();

export function setCsrf(token: string): void {
  csrf = token;
}
export function getCsrf(): string {
  return csrf;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly body: Partial<ApiError>,
  ) {
    super(body.message ?? `HTTP ${status}`);
  }
  get code(): string | undefined {
    return this.body.code;
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-RS-CSRF': csrf } : {}),
      'X-RS-Client': clientId,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiFailure(res.status, data ?? {});
  return data as T;
}

/** Upload an image file as-is; the server sniffs, checks and re-encodes it (SPEC §10.6). */
export async function uploadAsset(
  file: Blob,
): Promise<{ id: string; width: number; height: number; mime: string }> {
  const res = await fetch('/api/assets', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
      'X-RS-CSRF': csrf,
      'X-RS-Client': clientId,
    },
    body: file,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiFailure(res.status, data ?? {});
  return data;
}
