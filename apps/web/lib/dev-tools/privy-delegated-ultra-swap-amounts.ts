export type DelegatedUltraInputSide = 'BUY' | 'SELL';

export function submittedInputRawForBalance(input: {
  side: DelegatedUltraInputSide;
  requestedRaw: bigint;
  walletRaw: bigint;
}): bigint | null {
  if (input.requestedRaw <= 0n) return null;
  if (input.walletRaw >= input.requestedRaw) return input.requestedRaw;
  if (input.side === 'SELL' && input.walletRaw > 0n) return input.walletRaw;
  return null;
}
