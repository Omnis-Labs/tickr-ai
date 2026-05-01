// Jupiter Trigger v2 fetch wrapper.
//
// Centralises base URL, x-api-key header, and the optional JWT bearer.
// Every call site picks one of two helpers:
//   - jupiterPublicFetch  → only x-api-key (challenge/verify endpoints)
//   - jupiterAuthedFetch  → x-api-key + Authorization: Bearer <jwt>
// The authed variant takes a JWT-getter callback so the wallet/auth lib
// can lazily run challenge → verify on cache miss without this module
// having to import wallet plumbing.

import { getJupiterApiKey, jupiterUrl } from './config.js';

interface BaseOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Override response parser when the endpoint isn't JSON. */
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

function requireApiKey(): string {
  const key = getJupiterApiKey();
  if (!key) {
    throw new JupiterApiError(
      'NEXT_PUBLIC_JUPITER_API_KEY not configured',
      0,
      'Jupiter Trigger v2 requires an API key. Apply at https://portal.jup.ag.',
    );
  }
  return key;
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
  const apiKey = requireApiKey();
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: {
      'x-api-key': apiKey,
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  };
  return run(path, init, opts.expect ?? 'json') as Promise<T>;
}

export async function jupiterAuthedFetch<T>(path: string, opts: AuthedOptions): Promise<T> {
  const apiKey = requireApiKey();
  const jwt = await opts.getJwt();
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    headers: {
      'x-api-key': apiKey,
      Authorization: `Bearer ${jwt}`,
      ...(opts.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  };
  return run(path, init, opts.expect ?? 'json') as Promise<T>;
}
