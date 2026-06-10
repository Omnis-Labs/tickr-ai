import type { Bar } from '@hunch-it/shared';
import { getRequiredGrillBarAssetIds } from './analysis';

export type FetchGrillDailyBars = (assetId: string, days?: number) => Promise<readonly Bar[]>;

export async function fetchRequiredGrillBars(input: {
  assetId: string;
  analystIds?: readonly string[];
  days?: number;
  fetchDailyBars: FetchGrillDailyBars;
}): Promise<Map<string, readonly Bar[]>> {
  const requiredAssetIds = getRequiredGrillBarAssetIds(input.assetId, input.analystIds);
  const entries = await Promise.all(
    requiredAssetIds.map(async (assetId) => {
      const bars = await input.fetchDailyBars(assetId, input.days);
      return [assetId, bars] as const;
    }),
  );
  return new Map(entries);
}
