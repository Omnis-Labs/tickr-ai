// RPC URL string parser — dependency-free, safe to import from any bundle
// (server, client, edge). Lives in its own file so the heavier failover
// pool in `./rpc.ts` (which pulls in @solana/web3.js) stays isolated from
// callers that only need URL parsing.

const SOLANA_MAINNET_FALLBACK = 'https://api.mainnet-beta.solana.com';

/**
 * Parse a comma-separated RPC URL string into a deduped, validated array.
 * Production: throws when the input is non-empty but yields zero valid URLs,
 * or when input is empty (callers must configure RPC).
 * Dev / test: returns `[SOLANA_MAINNET_FALLBACK]` so local boot still works.
 */
export function parseRpcUrls(raw: string | undefined): string[] {
  const trimmed = raw?.trim() ?? '';
  if (trimmed.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[rpc] SOLANA_RPC_URLS / NEXT_PUBLIC_SOLANA_RPC_URLS is required in production',
      );
    }
    return [SOLANA_MAINNET_FALLBACK];
  }

  const seen = new Set<string>();
  const valid: string[] = [];
  for (const candidate of trimmed.split(',').map((u) => u.trim()).filter(Boolean)) {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      console.warn(`[rpc] dropping malformed RPC URL: ${candidate}`);
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      console.warn(`[rpc] dropping non-http(s) RPC URL: ${candidate}`);
      continue;
    }
    const normalized = url.toString();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      valid.push(normalized);
    }
  }

  if (valid.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[rpc] no valid RPC URLs after parsing — check SOLANA_RPC_URLS / NEXT_PUBLIC_SOLANA_RPC_URLS format',
      );
    }
    return [SOLANA_MAINNET_FALLBACK];
  }
  return valid;
}
