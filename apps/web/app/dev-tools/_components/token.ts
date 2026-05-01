/**
 * Token used by every section that places a real Jupiter order.
 *
 * WEN (Wen New Standard) is the canonical Token-2022 example on Solana with
 * deep Jupiter liquidity, a public Pyth Hermes feed, and 24/7 trading. It is
 * deliberately disjoint from the production proposal universe (xStocks +
 * SOL/cbBTC) so manual dev-tools activity cannot be mistaken for live
 * mandate execution.
 */
export const DEV_TOOLS_TOKEN = {
  symbol: 'WEN',
  mint: 'WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk',
  decimals: 5,
  pythFeedId:
    '0x5169491cd7e2a44c98353b779d5eb612e4ac32e073f5cc534303d86307c2f1bc',
} as const;

export const TRIGGER_DEFAULTS = {
  slippageBps: 50,
  expirySeconds: 60,
} as const;
