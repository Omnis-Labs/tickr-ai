/**
 * Verifies a candidate set of xStock mint addresses against Solana mainnet via
 * Helius RPC. Reads the candidate list from `data/xstock-candidates.json`,
 * checks each one is owned by SPL Token-2022, has the expected decimals, and
 * dumps a verified result to `data/xstock-mints.json` plus a TS snippet you
 * can paste into `packages/shared/src/constants.ts`.
 *
 * Run:
 *   pnpm --filter @hunch-it/ws-server verify:xstocks
 *
 * Candidate file format (`data/xstock-candidates.json`):
 *   {
 *     "AAPL": "<mint base58>",
 *     "NVDA": "<mint base58>",
 *     ...
 *   }
 *
 * If `data/xstock-candidates.json` does not exist, this script prints the path
 * it expects and exits non-zero.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  BARE_TICKERS,
  TOKEN_2022_PROGRAM_ID,
  XSTOCKS,
  parseRpcUrls,
  type BareTicker,
} from '@hunch-it/shared';
import { env } from '../src/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const CANDIDATES_PATH = join(DATA_DIR, 'xstock-candidates.json');
const OUTPUT_PATH = join(DATA_DIR, 'xstock-mints.json');

const EXPECTED_DECIMALS = 8;

interface VerifiedMint {
  ticker: BareTicker;
  mint: string;
  owner: string;
  decimals: number;
  supply: string;
  ok: boolean;
  errors: string[];
}

async function main() {
  if (!existsSync(CANDIDATES_PATH)) {
    console.error(
      `[verify] missing ${CANDIDATES_PATH}\n\n` +
        `Create it with the canonical xStock mint addresses, e.g.:\n` +
        `{\n` +
        BARE_TICKERS.map((t) => `  "${t}": "<mint base58>"`).join(',\n') +
        `\n}\n\n` +
        `Source: https://xstocks.com/products (Backed Finance) or Solscan / Jupiter token list.`,
    );
    process.exit(1);
  }

  const rpcUrls = parseRpcUrls(env.NEXT_PUBLIC_SOLANA_RPC_URLS);
  if (rpcUrls[0] === 'https://api.mainnet-beta.solana.com') {
    console.error('[verify] NEXT_PUBLIC_SOLANA_RPC_URLS not set (Helius RPC required).');
    process.exit(1);
  }

  const candidates = JSON.parse(readFileSync(CANDIDATES_PATH, 'utf8')) as Record<string, string>;
  const conn = new Connection(rpcUrls[0]!, 'confirmed');

  const results: VerifiedMint[] = [];
  for (const ticker of BARE_TICKERS) {
    const mint = candidates[ticker];
    const errors: string[] = [];
    if (!mint) {
      errors.push('missing in candidates file');
      results.push({
        ticker,
        mint: mint ?? '',
        owner: '',
        decimals: 0,
        supply: '0',
        ok: false,
        errors,
      });
      continue;
    }

    try {
      const pubkey = new PublicKey(mint);
      const info = await conn.getParsedAccountInfo(pubkey, 'confirmed');
      if (!info.value) {
        errors.push('account not found');
        results.push({
          ticker,
          mint,
          owner: '',
          decimals: 0,
          supply: '0',
          ok: false,
          errors,
        });
        continue;
      }
      const owner = info.value.owner.toBase58();
      if (owner !== TOKEN_2022_PROGRAM_ID) {
        errors.push(
          `owner is ${owner} but xStocks should be SPL Token-2022 (${TOKEN_2022_PROGRAM_ID})`,
        );
      }
      const data = info.value.data;
      let decimals = 0;
      let supply = '0';
      if ('parsed' in data && data.parsed?.info) {
        decimals = Number(data.parsed.info.decimals ?? 0);
        supply = String(data.parsed.info.supply ?? '0');
      } else {
        errors.push('account data not parsable as a Mint');
      }
      if (decimals !== EXPECTED_DECIMALS) {
        errors.push(`decimals=${decimals}, expected ${EXPECTED_DECIMALS}`);
      }
      results.push({
        ticker,
        mint,
        owner,
        decimals,
        supply,
        ok: errors.length === 0,
        errors,
      });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      results.push({
        ticker,
        mint,
        owner: '',
        decimals: 0,
        supply: '0',
        ok: false,
        errors,
      });
    }
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));

  const okCount = results.filter((r) => r.ok).length;
  console.log('\n--- xStock mint verification ---');
  for (const r of results) {
    const status = r.ok ? '✅' : '❌';
    console.log(`${status} ${r.ticker.padEnd(6)} ${r.mint || '(missing)'}`);
    for (const e of r.errors) console.log(`     · ${e}`);
  }
  console.log(`\n${okCount}/${results.length} verified.`);

  if (okCount === 0) {
    console.error('No mints verified. Refusing to print constants snippet.');
    process.exit(1);
  }

  console.log('\nPaste into packages/shared/src/constants.ts (XSTOCKS):\n');
  for (const r of results) {
    if (!r.ok) continue;
    const meta = XSTOCKS[r.ticker];
    console.log(`  ${r.ticker}: { ...XSTOCKS.${r.ticker}, mint: '${r.mint}' },  // ${meta.name}`);
  }
}

main().catch((err) => {
  console.error('[verify] failed', err);
  process.exit(1);
});
