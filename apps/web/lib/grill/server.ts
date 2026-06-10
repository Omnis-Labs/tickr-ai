import 'server-only';

import { z } from 'zod';
import { buildCreateBuyProposalForUserInput, createBuyProposalForUser } from '@hunch-it/db';
import {
  PYTH_BENCHMARK_GRILL_DAILY_CLIENT_SETTINGS,
  PYTH_BENCHMARKS_BASE,
  createPythBenchmarkBarsClient,
  evaluateSignalDataFreshness,
  getSignalAssets,
  type Bar,
  type PythBenchmarkFetch,
} from '@hunch-it/shared';
import { expireActiveProposals, prisma } from '@/lib/db';
import { decimalsToNumbers } from '@/lib/db/decimal';
import { getCurrentPriceSnapshots } from '@/lib/pyth';
import { readUsdcBalance } from '@/lib/solana/usdc-balance';
import { AI_ANALYST_CATALOG, MAX_AI_TRADING_TEAM_SIZE } from './catalog';
import {
  analyzeGrillIdea,
  getRequiredGrillBarAssetIds,
  type GrillAnalysisResult,
} from './analysis';
import { consumeGrillAnalysisDraft } from './drafts';
import { buildGrillProposalAnalysis } from './proposal-policy';

const BENCHMARKS = process.env.PYTH_BENCHMARKS_URL ?? PYTH_BENCHMARKS_BASE;
const benchmarks = createPythBenchmarkBarsClient({
  baseUrl: BENCHMARKS,
  fetchImpl: fetch as unknown as PythBenchmarkFetch,
  cacheMode: 'no-store',
  ...PYTH_BENCHMARK_GRILL_DAILY_CLIENT_SETTINGS,
});
const SIGNAL_ASSET_IDS = new Set(getSignalAssets().map((asset) => asset.assetId));
const ANALYST_IDS = new Set(AI_ANALYST_CATALOG.map((analyst) => analyst.id));

export const GrillRequestSchema = z.object({
  assetId: z.string().refine((value) => SIGNAL_ASSET_IDS.has(value), {
    message: 'Unsupported Grill asset',
  }),
  idea: z.string().trim().min(8).max(1_000),
  analystIds: z
    .array(z.string().refine((value) => ANALYST_IDS.has(value), { message: 'Unknown analyst' }))
    .max(MAX_AI_TRADING_TEAM_SIZE)
    .optional(),
});

type GrillRequest = z.infer<typeof GrillRequestSchema>;

export class GrillAnalysisDraftRequiredError extends Error {
  constructor() {
    super('grill_analysis_required');
    this.name = 'GrillAnalysisDraftRequiredError';
  }
}

async function fetchDailyBars(assetId: string, days = 365): Promise<Bar[]> {
  return benchmarks.getDailyBars({ assetId, days });
}

export async function runGrillAnalysis(input: GrillRequest): Promise<GrillAnalysisResult> {
  const requiredAssets = getRequiredGrillBarAssetIds(input.assetId, input.analystIds);
  const barsByAssetId = new Map<string, Bar[]>();
  for (const assetId of requiredAssets) {
    barsByAssetId.set(assetId, await fetchDailyBars(assetId));
  }
  return analyzeGrillIdea({
    assetId: input.assetId,
    idea: input.idea,
    analystIds: input.analystIds,
    barsByAssetId,
  });
}

export async function createGrillProposal(input: GrillRequest & { userId: string }): Promise<{
  proposal: unknown;
  analysis: GrillAnalysisResult;
  telemetry: {
    latestPrice: number;
    priceAgeSeconds: number;
  };
}> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    include: { mandate: true },
  });
  if (!user) throw new Error('user not found');
  if (!user.mandate) throw new Error('complete mandate before using Grill');

  const result = consumeGrillAnalysisDraft({
    userId: input.userId,
    request: input,
  });
  if (!result) throw new GrillAnalysisDraftRequiredError();

  const priceMap = await getCurrentPriceSnapshots([input.assetId]);
  const latestSnap = priceMap.get(input.assetId) ?? null;
  if (!latestSnap) throw new Error(`No Pyth price for ${input.assetId}`);
  const freshness = evaluateSignalDataFreshness(latestSnap);
  if (!freshness.fresh) {
    throw new Error(`Stale Pyth price for ${input.assetId}: ${freshness.reason}`);
  }

  const analysis = buildGrillProposalAnalysis({
    result,
    latestPrice: latestSnap.price,
  });
  if (!analysis) {
    throw new Error('grill_proposal_not_actionable');
  }

  const availableUsdc = await readUsdcBalance(user.walletAddress, {
    forceFresh: true,
    throwOnFailure: true,
  });
  const mandate = user.mandate;

  const proposal = await prisma.$transaction(async (tx) => {
    const now = new Date();
    await expireActiveProposals(tx, { userId: input.userId, origin: 'GRILL', now });
    const created = await createBuyProposalForUser(
      tx,
      buildCreateBuyProposalForUserInput({
        userId: input.userId,
        analysis,
        mandate,
        positionImpact: {
          totalUsd: availableUsdc,
          cashUsd: availableUsdc,
          assetExposureUsd: 0,
          verticalExposureUsd: 0,
        },
        origin: 'GRILL',
        originContext: {
          grillIdea: result.idea,
          analystIds: result.opinions.map((opinion) => opinion.analystId),
        },
        now,
        rationalePrefix: '[Grill] ',
      }),
    );
    if (!created) throw new Error('grill_proposal_not_actionable');
    return created;
  });

  return {
    proposal: decimalsToNumbers({
      ...proposal,
      expiresAt: proposal.expiresAt.toISOString(),
      createdAt: proposal.createdAt.toISOString(),
    }),
    analysis: result,
    telemetry: {
      latestPrice: latestSnap.price,
      priceAgeSeconds: freshness.ageSeconds,
    },
  };
}
