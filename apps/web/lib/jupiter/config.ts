// Jupiter Trigger v2 client configuration.
//
// v2 base URL is `https://api.jup.ag` (NOT `https://lite-api.jup.ag` —
// that's the legacy Quote/Ultra endpoint). Every Trigger v2 request
// requires `x-api-key`; user-scoped endpoints additionally require a
// per-wallet JWT (see ./auth.ts).
//
// Apply for an API key at https://portal.jup.ag (sign in with a Solana
// wallet → API Keys → create). Free tier is enough for hackathon
// volume; production traffic eventually needs a paid plan.

export const JUPITER_BASE_URL =
  process.env.NEXT_PUBLIC_JUPITER_API_BASE_V2 ?? 'https://api.jup.ag';

/**
 * Public + server-readable. We expose the key in the bundle on purpose:
 * Jupiter v2 auth always pairs the api-key with a per-wallet JWT, so
 * leaking the key alone gives an attacker only the same rate-limited
 * unauthenticated surface anyone gets by visiting the docs page.
 */
export function getJupiterApiKey(): string | null {
  // NEXT_PUBLIC_ so it's available both in the browser bundle and in
  // server-side route handlers / ws-server. Returns null when unset so
  // callers can degrade gracefully (we surface a banner instead of
  // throwing).
  return process.env.NEXT_PUBLIC_JUPITER_API_KEY ?? null;
}

export function jupiterUrl(path: string): string {
  if (!path.startsWith('/')) throw new Error(`jupiterUrl: path must start with / (got "${path}")`);
  return `${JUPITER_BASE_URL}${path}`;
}
