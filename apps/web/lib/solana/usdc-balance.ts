// Server-only helper: read a wallet's USDC balance via Solana RPC.
//
// Walks the configured RPC list and falls back on per-call errors —
// some free RPCs (e.g. publicnode.com) block getTokenAccountsByOwner,
// so a single-endpoint connection is fragile. We cache the resolved
// balance per wallet for 60s so the desk page's 15s portfolio refetch
// doesn't pound the RPCs. Mutations can request a forced fresh read to
// bypass this cache and refresh the stored value.

import 'server-only';
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { USDC_DECIMALS, USDC_MINT, parseRpcUrls } from '@hunch-it/shared';

const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TTL_MS = 60_000;

let connectionPool: Connection[] | null = null;
function getConnections(): Connection[] {
  if (connectionPool) return connectionPool;
  const rpcUrls = parseRpcUrls(process.env.NEXT_PUBLIC_SOLANA_RPC_URLS);
  connectionPool = rpcUrls.map((url) => new Connection(url, 'confirmed'));
  return connectionPool;
}

const cache = new Map<string, { at: number; usd: number }>();
const solCache = new Map<string, { at: number; sol: number }>();

interface BalanceReadOptions {
  forceFresh?: boolean;
  throwOnFailure?: boolean;
}

export async function readUsdcBalance(
  walletAddress: string,
  options: BalanceReadOptions = {},
): Promise<number> {
  const cached = cache.get(walletAddress);
  if (!options.forceFresh && cached && Date.now() - cached.at < TTL_MS) return cached.usd;

  let owner: PublicKey;
  try {
    owner = new PublicKey(walletAddress);
  } catch {
    if (options.throwOnFailure) throw new Error('Invalid wallet address.');
    return 0;
  }

  const programId = new PublicKey(SPL_TOKEN_PROGRAM);
  const conns = getConnections();
  let lastErr: unknown = null;

  for (const conn of conns) {
    try {
      const res = await conn.getParsedTokenAccountsByOwner(owner, { programId });
      let raw = 0;
      for (const acct of res.value) {
        const info = acct.account.data;
        if (!('parsed' in info) || !info.parsed?.info?.mint) continue;
        if (info.parsed.info.mint !== USDC_MINT) continue;
        raw += Number(info.parsed.info.tokenAmount?.amount ?? '0');
      }
      const usd = raw / 10 ** USDC_DECIMALS;
      cache.set(walletAddress, { at: Date.now(), usd });
      return usd;
    } catch (err) {
      lastErr = err;
      // Loop to next RPC. Common case: 403 from a public RPC that
      // blocks getTokenAccountsByOwner.
    }
  }

  const message = `[portfolio] usdc balance fetch failed for ${walletAddress.slice(0, 6)}…`;
  console.warn(message, lastErr);
  if (options.throwOnFailure) throw new Error(message);
  return 0;
}

export async function readSolBalance(
  walletAddress: string,
  options: BalanceReadOptions = {},
): Promise<number> {
  const cached = solCache.get(walletAddress);
  if (!options.forceFresh && cached && Date.now() - cached.at < TTL_MS) return cached.sol;

  let owner: PublicKey;
  try {
    owner = new PublicKey(walletAddress);
  } catch {
    if (options.throwOnFailure) throw new Error('Invalid wallet address.');
    return 0;
  }

  const conns = getConnections();
  let lastErr: unknown = null;

  for (const conn of conns) {
    try {
      const lamports = await conn.getBalance(owner, 'confirmed');
      const sol = lamports / LAMPORTS_PER_SOL;
      solCache.set(walletAddress, { at: Date.now(), sol });
      return sol;
    } catch (err) {
      lastErr = err;
    }
  }

  const message = `[portfolio] sol balance fetch failed for ${walletAddress.slice(0, 6)}…`;
  console.warn(message, lastErr);
  if (options.throwOnFailure) throw new Error(message);
  return 0;
}
