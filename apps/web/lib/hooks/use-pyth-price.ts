'use client';

import { useQuery } from '@tanstack/react-query';
import { PYTH_HERMES_DEFAULT_URL } from '@hunch-it/shared';

/**
 * Live Pyth price for a single Hermes feed id.
 *
 * Hermes is the public Pyth REST endpoint that returns the latest price
 * update for one or more feeds. We poll once per second by default — no
 * `ageSeconds` is exposed because at 1Hz the staleness window is dominated
 * by network latency, not refresh cadence.
 *
 * Pass an empty `feedId` (e.g. when the parent component hasn't picked an
 * asset yet) to short-circuit: the hook stays disabled and returns
 * `{ price: null, publishTime: null }`.
 */

interface HermesPriceUpdate {
  parsed?: Array<{
    id: string;
    price: {
      price: string;
      conf: string;
      expo: number;
      publish_time: number;
    };
  }>;
}

export interface UsePythPriceResult {
  price: number | null;
  publishTime: number | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function usePythPrice(feedId: string, refetchMs: number = 1_000): UsePythPriceResult {
  const enabled = feedId.length > 0;
  const query = useQuery<{ price: number; publishTime: number } | null>({
    queryKey: ['pyth-price', feedId],
    queryFn: async () => {
      const url = new URL('/v2/updates/price/latest', PYTH_HERMES_DEFAULT_URL);
      url.searchParams.set('ids[]', feedId);
      url.searchParams.set('parsed', 'true');
      const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
      if (!res.ok) {
        throw new Error(`Pyth Hermes ${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as HermesPriceUpdate;
      const entry = body.parsed?.[0];
      if (!entry) return null;
      const raw = Number(entry.price.price);
      if (!Number.isFinite(raw)) return null;
      return {
        price: raw * Math.pow(10, entry.price.expo),
        publishTime: entry.price.publish_time,
      };
    },
    refetchInterval: enabled ? refetchMs : false,
    enabled,
    staleTime: 0,
  });

  return {
    price: query.data?.price ?? null,
    publishTime: query.data?.publishTime ?? null,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    refetch: () => {
      if (!enabled) return;
      void query.refetch();
    },
  };
}
