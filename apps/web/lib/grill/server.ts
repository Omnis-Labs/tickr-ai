import 'server-only';

import { z } from 'zod';
import { createBuyProposalForUser } from '@hunch-it/db';
import {
  PYTH_BENCHMARKS_BASE,
  evaluateSignalDataFreshness,
  getSignalAssets,
  requireAsset,
  type Bar,
} from '@hunch-it/shared';
import { expireActiveProposals, prisma } from '@/lib/db';
import { decimalsToNumbers } from '@/lib/db/decimal';
import { getCurrentPriceSnapshots } from '@/lib/pyth';
import { readUsdcBalance } from '@/lib/solana/usdc-balance';
import {
  AI_ANALYST_CATALOG,
  MAX_AI_TRADING_TEAM_SIZE,
  analyzeGrillIdea,
  getRequiredGrillBarAssetIds,
  type GrillAnalysisResult,
} from './analysis';
import { buildGrillProposalAnalysis } from './proposal-policy';

const BENCHMARKS = process.env.PYTH_BENCHMARKS_URL ?? PYTH_BENCHMARKS_BASE;
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

interface TvResponse {
  s: 'ok' | 'no_data' | 'error';
  t?: number[];
  o?: number[];
  h?: number[];
  l?: number[];
  c?: number[];
  errmsg?: string;
}

async function fetchDailyBars(assetId: string, days = 365): Promise<Bar[]> {
  const asset = requireAsset(assetId);
  if (!asset.pythSymbol) throw new Error(`${assetId} has no Pyth symbol configured`);
  const to = Math.floor(Date.now() / 1000);
  const from = to - days * 86_400;
  const url =
    `${BENCHMARKS}/v1/shims/tradingview/history` +
    `?symbol=${encodeURIComponent(asset.pythSymbol)}` +
    `&resolution=D&from=${from}&to=${to}`;

  const res = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`Pyth benchmarks failed for ${assetId}: ${res.status}`);
  const json = (await res.json()) as TvResponse;
  if (json.s === 'no_data') return [];
  if (json.s !== 'ok' || !json.o || !json.h || !json.l || !json.c) {
    throw new Error(`Pyth benchmarks failed for ${assetId}: ${json.errmsg ?? json.s}`);
  }
  if (!json.t) return [];
  return json.t.map((time, index) => ({
    time,
    open: json.o![index] ?? 0,
    high: json.h![index] ?? 0,
    low: json.l![index] ?? 0,
    close: json.c![index] ?? 0,
  }));
}

export async function runGrillAnalysis(input: GrillRequest): Promise<GrillAnalysisResult> {
  const requiredAssets = getRequiredGrillBarAssetIds(input.assetId, input.analystIds);
  const barsByAssetId = new Map<string, Bar[]>();
  await Promise.all(
    requiredAssets.map(async (assetId) => {
      barsByAssetId.set(assetId, await fetchDailyBars(assetId));
    }),
  );
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

  const priceMap = await getCurrentPriceSnapshots([input.assetId]);
  const latestSnap = priceMap.get(input.assetId) ?? null;
  if (!latestSnap) throw new Error(`No Pyth price for ${input.assetId}`);
  const freshness = evaluateSignalDataFreshness(latestSnap);
  if (!freshness.fresh) {
    throw new Error(`Stale Pyth price for ${input.assetId}: ${freshness.reason}`);
  }

  const result = await runGrillAnalysis(input);
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
  const maxTradeSize = mandate.maxTradeSize.toNumber();
  const maxDrawdown = mandate.maxDrawdown?.toNumber() ?? null;

  const proposal = await prisma.$transaction(async (tx) => {
    const now = new Date();
    await expireActiveProposals(tx, { userId: input.userId, origin: 'GRILL', now });
    const created = await createBuyProposalForUser(tx, {
      userId: input.userId,
      analysis,
      mandate: {
        holdingPeriod: mandate.holdingPeriod,
        maxTradeSizeUsd: maxTradeSize,
        maxDrawdown,
      },
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
    });
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
