// Portfolio context — reads a user's USDC + open xStock balances on-chain
// so the Proposal Generator can fill positionImpact with real weight /
// cash / sector deltas instead of zeros.
//
// We hit the Solana RPC once per user per proposal (cached for 30s by
// walletAddress). Hot path is short-lived so we don't bother with batched
// getMultipleAccounts — the read is GET getParsedTokenAccountsByOwner
// per program (one call for SPL Token, one for Token-2022).

import { Connection, PublicKey } from '@solana/web3.js';
import {
  TOKEN_2022_PROGRAM_ID,
  USDC_DECIMALS,
  USDC_MINT,
  XSTOCKS,
  parseRpcUrls,
  type BareTicker,
} from '@hunch-it/shared';
import { env } from '../env.js';

const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

let lazyConn: Connection | null = null;
function getConn(): Connection {
  if (lazyConn) return lazyConn;
  const rpcUrls = parseRpcUrls(env.NEXT_PUBLIC_SOLANA_RPC_URLS);
  lazyConn = new Connection(rpcUrls[0]!, 'confirmed');
  return lazyConn;
}

interface BalancesByMint {
  /** mint base58 → human token amount (mint decimals applied) */
  byMint: Map<string, number>;
}

const cache = new Map<string, { at: number; data: BalancesByMint }>();
const TTL_MS = 30_000;

async function readBalances(walletAddress: string): Promise<BalancesByMint> {
  const cached = cache.get(walletAddress);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;

  const conn = getConn();
  let owner: PublicKey;
  try {
    owner = new PublicKey(walletAddress);
  } catch {
    return { byMint: new Map() };
  }

  const byMint = new Map<string, number>();
  for (const programId of [SPL_TOKEN_PROGRAM, TOKEN_2022_PROGRAM_ID]) {
    try {
      const res = await conn.getParsedTokenAccountsByOwner(owner, {
        programId: new PublicKey(programId),
      });
      for (const acct of res.value) {
        const info = acct.account.data;
        if (!('parsed' in info) || !info.parsed?.info?.mint) continue;
        const mint = String(info.parsed.info.mint);
        const decimals = Number(info.parsed.info.tokenAmount?.decimals ?? 0);
        const raw = String(info.parsed.info.tokenAmount?.amount ?? '0');
        const amount = Number(raw) / 10 ** decimals;
        byMint.set(mint, (byMint.get(mint) ?? 0) + amount);
      }
    } catch (err) {
      console.warn(`[portfolio] balances fetch (${programId.slice(0, 6)}…) failed`, err);
    }
  }

  const data = { byMint };
  cache.set(walletAddress, { at: Date.now(), data });
  return data;
}

export interface PositionImpactContext {
  /** Total USD value (USDC + xStocks at last-known prices). */
  totalUsd: number;
  cashUsd: number;
  /** USD value the user already holds in this ticker (0 if no position). */
  tickerExposureUsd: number;
  /** USD value the user holds across the same vertical. */
  sectorExposureUsd: number;
}

/**
 * Compute the portfolio context for a single user × ticker pair. xStock
 * marks come from the Pyth scanner cache (passed in); USDC defaults to $1.
 *
 * If the wallet read fails for any reason (RPC outage, bad address), all
 * fields return 0 — the Proposal still gets sent but with degenerate
 * positionImpact, same as the previous Phase E behaviour. Callers don't
 * need to special-case this.
 */
export async function computePositionImpact(args: {
  walletAddress: string;
  bareTicker: BareTicker;
  /** Verticals the bareTicker belongs to (for sector aggregate). */
  sameVerticalBareTickers: readonly BareTicker[];
  /** Pyth marks per BareTicker; missing entries treated as zero. */
  marksByBareTicker: Map<BareTicker, number>;
}): Promise<PositionImpactContext> {
  const balances = await readBalances(args.walletAddress);
  if (balances.byMint.size === 0) {
    return { totalUsd: 0, cashUsd: 0, tickerExposureUsd: 0, sectorExposureUsd: 0 };
  }

  const cashUsd =
    Math.round(((balances.byMint.get(USDC_MINT) ?? 0) * 10 ** USDC_DECIMALS)) /
    10 ** USDC_DECIMALS;

  let totalXStockUsd = 0;
  let tickerExposureUsd = 0;
  let sectorExposureUsd = 0;

  for (const bare of Object.keys(XSTOCKS) as BareTicker[]) {
    const meta = XSTOCKS[bare];
    if (!meta.mint) continue;
    const tokenAmt = balances.byMint.get(meta.mint) ?? 0;
    if (tokenAmt === 0) continue;
    const mark = args.marksByBareTicker.get(bare) ?? 0;
    const usd = tokenAmt * mark;
    totalXStockUsd += usd;
    if (bare === args.bareTicker) tickerExposureUsd += usd;
    if (args.sameVerticalBareTickers.includes(bare)) sectorExposureUsd += usd;
  }

  return {
    totalUsd: cashUsd + totalXStockUsd,
    cashUsd,
    tickerExposureUsd,
    sectorExposureUsd,
  };
}
