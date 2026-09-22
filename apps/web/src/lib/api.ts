import type { ApiError } from '@raelstream/contracts';

let csrf = '';

export function setCsrf(token: string): void {
  csrf = token;
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
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiFailure(res.status, data ?? {});
  return data as T;
}
