import type { PriceSnapshot } from './types.js';

export const SIGNAL_DATA_MAX_AGE_SECONDS = 15 * 60;

export interface SignalDataFreshnessVerdict {
  fresh: boolean;
  ageSeconds: number;
  reason?: string;
}

export function evaluateSignalDataFreshness(
  snap: Pick<PriceSnapshot, 'publishTime'>,
  opts: { maxAgeSeconds?: number; bypass?: boolean; nowUnixSeconds?: number } = {},
): SignalDataFreshnessVerdict {
  const nowUnixSeconds = opts.nowUnixSeconds ?? Math.floor(Date.now() / 1000);
  const ageSeconds = Math.max(0, nowUnixSeconds - snap.publishTime);
  const maxAgeSeconds = opts.maxAgeSeconds ?? SIGNAL_DATA_MAX_AGE_SECONDS;

  if (opts.bypass) {
    return { fresh: true, ageSeconds, reason: 'bypassed' };
  }
  if (ageSeconds <= maxAgeSeconds) {
    return { fresh: true, ageSeconds };
  }
  return {
    fresh: false,
    ageSeconds,
    reason: `price is ${ageSeconds}s old (>${maxAgeSeconds}s)`,
  };
}
