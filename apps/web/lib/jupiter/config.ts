// Jupiter Trigger v2 client configuration (browser side).
//
// Browser code MUST go through our same-origin proxy at /api/jupiter/*
// because Jupiter's CORS preflight rejects the `x-api-key` header from
// cross-origin callers. The proxy adds the api-key on the server side
// and preserves the rest of the request unchanged.
//
// Server-side code (ws-server tracker, /api/* route handlers) can hit
// api.jup.ag directly and reads NEXT_PUBLIC_JUPITER_API_BASE_V2 / the
// JUPITER_API_KEY env there. This file is only the BROWSER's view.

export const JUPITER_BASE_URL = '/api/jupiter';

export function jupiterUrl(path: string): string {
  if (!path.startsWith('/')) throw new Error(`jupiterUrl: path must start with / (got "${path}")`);
  return `${JUPITER_BASE_URL}${path}`;
}
