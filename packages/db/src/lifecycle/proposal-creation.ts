import { Prisma, type PrismaClient, type Proposal, type ProposalOrigin } from '@prisma/client';
import {
  MIN_ACTIONABLE_CONFIDENCE,
  extractThesisTags,
  type BaseMarketAnalysis,
  type BaseMarketIndicators,
} from '@hunch-it/shared';

type Tx = Prisma.TransactionClient;

export type ProposalAnalysisIndicators = BaseMarketIndicators;
export type BuyMarketAnalysis = BaseMarketAnalysis;

export interface ProposalCreationMandate {
  holdingPeriod: string;
  maxTradeSizeUsd: number;
  maxDrawdown: number | null;
}

export interface ProposalCreationPositionImpact {
  totalUsd: number;
  cashUsd: number;
  assetExposureUsd: number;
  verticalExposureUsd: number;
}

export interface CreateBuyProposalForUserInput {
  userId: string;
  analysis: BuyMarketAnalysis;
  mandate: ProposalCreationMandate;
  positionImpact: ProposalCreationPositionImpact;
  origin?: ProposalOrigin;
  now?: Date;
  sizeUsd?: number;
  sizeRationale?: string;
  rationalePrefix?: string;
}

const HOLDING_PERIOD_TO_TTL_MIN: Record<string, number> = {
  '1-3 days': 30,
  '1-2 weeks': 90,
  '1-3 months': 180,
  '6+ months': 240,
};

function roundPrice(value: number): number {
  return Number(value.toFixed(2));
}

function defaultSizeUsd(maxTradeSizeUsd: number): number {
  const baseSize = maxTradeSizeUsd * 0.4;
  return Math.min(maxTradeSizeUsd, Math.max(20, Math.round(baseSize)));
}

function ttlMinutesForHoldingPeriod(holdingPeriod: string): number {
  return HOLDING_PERIOD_TO_TTL_MIN[holdingPeriod] ?? 60;
}

function buildPrices(input: {
  analysis: BuyMarketAnalysis;
  mandate: ProposalCreationMandate;
}): {
  triggerPrice: number;
  tpPrice: number;
  slPrice: number;
  slPct: number;
} {
  const triggerPrice = roundPrice(
    input.analysis.suggestedTriggerPrice ?? input.analysis.priceAtAnalysis * 0.997,
  );
  const tpPct = input.analysis.suggestedTpPct ?? 0.04;
  const rawTp = input.analysis.suggestedTakeProfitPrice ?? triggerPrice * (1 + tpPct);
  const tpPrice = roundPrice(Math.max(rawTp, triggerPrice * 1.01));

  const slPct = input.analysis.suggestedSlPct ?? 0.025;
  const rawSl = input.analysis.suggestedStopLossPrice ?? triggerPrice * (1 - slPct);
  const belowTriggerSl = Math.min(rawSl, triggerPrice * 0.995);
  const cappedSl =
    input.mandate.maxDrawdown == null
      ? belowTriggerSl
      : Math.max(belowTriggerSl, triggerPrice * (1 - input.mandate.maxDrawdown));
  const slPrice = roundPrice(cappedSl);

  return {
    triggerPrice,
    tpPrice,
    slPrice,
    slPct: Math.max(0, (triggerPrice - slPrice) / triggerPrice),
  };
}

function buildPositionImpact(input: {
  sizeUsd: number;
  positionImpact: ProposalCreationPositionImpact;
}): Prisma.InputJsonObject {
  const totalUsd = input.positionImpact.totalUsd;
  const weightBefore =
    totalUsd > 0 ? input.positionImpact.assetExposureUsd / totalUsd : 0;
  const weightAfter =
    totalUsd > 0 ? (input.positionImpact.assetExposureUsd + input.sizeUsd) / totalUsd : 0;
  const sectorBefore =
    totalUsd > 0 ? input.positionImpact.verticalExposureUsd / totalUsd : 0;
  const sectorAfter =
    totalUsd > 0 ? (input.positionImpact.verticalExposureUsd + input.sizeUsd) / totalUsd : 0;

  return {
    weight_before: +weightBefore.toFixed(4),
    weight_after: +weightAfter.toFixed(4),
    cash_after: +(input.positionImpact.cashUsd - input.sizeUsd).toFixed(2),
    sector_before: +sectorBefore.toFixed(4),
    sector_after: +sectorAfter.toFixed(4),
  };
}

function buildMandateReason(input: {
  mandate: ProposalCreationMandate;
  sizeUsd: number;
  slPrice: number;
  slPct: number;
  sizeRationale?: string;
}): string {
  const sizeRationale =
    input.sizeRationale ??
    `Size $${input.sizeUsd} is within your $${input.mandate.maxTradeSizeUsd.toFixed(0)} max trade size.`;

  return (
    `Fits your ${input.mandate.holdingPeriod} holding period. ` +
    `${sizeRationale} ` +
    `Suggested SL at $${input.slPrice} caps risk to ${(input.slPct * 100).toFixed(1)}%${
      input.mandate.maxDrawdown != null
        ? ` (within your ${(input.mandate.maxDrawdown * 100).toFixed(0)}% drawdown tolerance)`
        : ''
    }.`
  );
}

export function buildBuyProposalCreateData(
  input: CreateBuyProposalForUserInput,
): Prisma.ProposalUncheckedCreateInput | null {
  if (input.analysis.action !== 'BUY') return null;
  if (input.analysis.confidence < MIN_ACTIONABLE_CONFIDENCE) return null;

  const sizeUsd = input.sizeUsd ?? defaultSizeUsd(input.mandate.maxTradeSizeUsd);
  if (!(sizeUsd > 0)) return null;

  const { triggerPrice, tpPrice, slPrice, slPct } = buildPrices({
    analysis: input.analysis,
    mandate: input.mandate,
  });

  if (!(triggerPrice > 0) || !(tpPrice > 0) || !(slPrice > 0)) return null;

  const now = input.now ?? new Date();
  const ttlMin = ttlMinutesForHoldingPeriod(input.mandate.holdingPeriod);
  const whyFitsMandate = buildMandateReason({
    mandate: input.mandate,
    sizeUsd,
    slPrice,
    slPct,
    sizeRationale: input.sizeRationale,
  });

  return {
    userId: input.userId,
    ticker: input.analysis.assetId,
    action: 'BUY',
    suggestedSizeUsd: sizeUsd,
    suggestedTriggerPrice: triggerPrice,
    suggestedTakeProfitPrice: tpPrice,
    suggestedStopLossPrice: slPrice,
    rationale: `${input.rationalePrefix ?? ''}${input.analysis.rationale}`,
    reasoning: {
      what_changed: input.analysis.what_changed,
      why_this_trade: input.analysis.why_this_trade,
      why_fits_mandate: whyFitsMandate,
    },
    positionImpact: buildPositionImpact({
      sizeUsd,
      positionImpact: input.positionImpact,
    }),
    confidence: input.analysis.confidence,
    priceAtProposal: input.analysis.priceAtAnalysis,
    indicators: input.analysis.indicators as unknown as Prisma.InputJsonObject,
    thesisTags: extractThesisTags({
      rsi: input.analysis.indicators.rsi,
      ma20: input.analysis.indicators.ma20,
      ma50: input.analysis.indicators.ma50,
      price: input.analysis.priceAtAnalysis,
      macd: input.analysis.indicators.macd,
    }),
    origin: input.origin ?? 'SIGNAL_ENGINE',
    status: 'ACTIVE',
    expiresAt: new Date(now.getTime() + ttlMin * 60_000),
  };
}

export async function createBuyProposalForUser(
  client: Tx | PrismaClient,
  input: CreateBuyProposalForUserInput,
): Promise<Proposal | null> {
  const data = buildBuyProposalCreateData(input);
  if (!data) return null;
  return client.proposal.create({ data });
}
