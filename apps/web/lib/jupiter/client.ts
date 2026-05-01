// Jupiter Trigger v2 fetch wrapper (browser-side, via proxy).
//
// Hits /api/jupiter/* on our origin; the server attaches the x-api-key
// header that Jupiter's CORS rejects in browsers. JWT (Authorization)
// rides through the proxy unchanged because Jupiter does allow that
// header cross-origin (and the proxy preserves it).

import { jupiterUrl } from './config.js';

interface BaseOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  expect?: 'json' | 'text';
}

interface AuthedOptions extends BaseOptions {
  getJwt: () => Promise<string>;
}

export class JupiterApiError extends Error {
  status: number;
  body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'JupiterApiError';
    this.status = status;
    this.body = body;
  }
}

async function run(path: string, init: RequestInit, expect: 'json' | 'text'): Promise<unknown> {
  const res = await fetch(jupiterUrl(path), init);
  const text = await res.text();
  if (!res.ok) {
    throw new JupiterApiError(
      `Jupiter ${init.method ?? 'GET'} ${path} failed: ${res.status}`,
      res.status,
      text.slice(0, 500),
    );
  }
  if (expect === 'text' || text.length === 0) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new JupiterApiError(
      `Jupiter ${path} returned non-JSON`,
      res.status,
      text.slice(0, 200),
    );
  }
}

export async function jupiterPublicFetch<T>(path: string, opts: BaseOptions = {}): Promise<T> {
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  };
  return run(path, init, opts.expect ?? 'json') as Promise<T>;
}

export async function jupiterAuthedFetch<T>(path: string, opts: AuthedOptions): Promise<T> {
  const jwt = await opts.getJwt();
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${jwt}`,
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  };
  return run(path, init, opts.expect ?? 'json') as Promise<T>;
}
