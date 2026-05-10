/**
 * Pulls the Pyth Hermes feed registry, filters for configured asset symbols,
 * and writes the result to `data/pyth-feeds.json` plus a TS snippet to paste
 * into the shared asset registry.
 *
 * Run:
 *   pnpm --filter @hunch-it/ws-server fetch:pyth-feeds
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ASSET_REGISTRY } from '@hunch-it/shared';
import { env } from '../src/env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'pyth-feeds.json');

interface HermesFeed {
  id: string;
  attributes: Record<string, string | undefined> & {
    asset_type?: string;
    base?: string;
    quote_currency?: string;
    symbol?: string;
    description?: string;
    display_symbol?: string;
  };
}

async function main() {
  const url = `${env.PYTH_HERMES_URL}/v2/price_feeds?query=Crypto`;
  console.log(`[pyth] fetching ${url}`);
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    console.error(`[pyth] fetch failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const all = (await res.json()) as HermesFeed[];

  const wanted = ASSET_REGISTRY.filter((asset) => asset.pythSymbol.length > 0);
  const bySymbol = new Map<string, HermesFeed>();

  for (const feed of all) {
    const sym = feed.attributes.symbol ?? feed.attributes.display_symbol ?? '';
    if (!sym || bySymbol.has(sym)) continue;
    bySymbol.set(sym, feed);
  }

  const result: Record<string, { id: string; symbol: string; description: string }> = {};
  for (const asset of wanted) {
    const feed = bySymbol.get(asset.pythSymbol);
    if (!feed) {
      console.warn(`! no feed found for ${asset.assetId} (${asset.pythSymbol})`);
      continue;
    }
    const id = feed.id.startsWith('0x') ? feed.id : `0x${feed.id}`;
    result[asset.assetId] = {
      id,
      symbol: feed.attributes.symbol ?? '',
      description: feed.attributes.description ?? '',
    };
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`\nWrote ${Object.keys(result).length}/${wanted.length} feeds to ${OUTPUT_PATH}\n`);

  console.log('Feed ids by asset id:\n');
  for (const asset of wanted) {
    const r = result[asset.assetId];
    if (!r) continue;
    console.log(`  ${asset.assetId}: ${r.id}  // ${r.symbol}`);
  }
}

main().catch((err) => {
  console.error('[pyth] failed', err);
  process.exit(1);
});
