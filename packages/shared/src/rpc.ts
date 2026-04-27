const SOLANA_MAINNET_FALLBACK = 'https://api.mainnet-beta.solana.com';

/**
 * Parse a comma-separated RPC URL string into a trimmed, non-empty array.
 * Returns `[SOLANA_MAINNET_FALLBACK]` when the input is empty/undefined.
 */
export function parseRpcUrls(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) return [SOLANA_MAINNET_FALLBACK];
  const urls = raw
    .split(',')
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  return urls.length > 0 ? urls : [SOLANA_MAINNET_FALLBACK];
}

/**
 * Create a round-robin selector that cycles through the provided URLs.
 * Thread-safe for single-threaded JS runtimes (browser & Node).
 */
export function createRpcRoundRobin(raw: string | undefined): () => string {
  const urls = parseRpcUrls(raw);
  let idx = 0;
  return () => {
    const url = urls[idx % urls.length]!;
    idx = (idx + 1) % urls.length;
    return url;
  };
}
