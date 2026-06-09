import type { BaseMarketAnalysis } from '@hunch-it/shared';
import type { AnalystOpinion, GrillAnalysisResult } from './analysis';

type ProposalBusyState = 'analysis' | 'proposal' | null;

export interface GrillProposalRequest {
  assetId: string;
  idea: string;
  analystIds: string[];
}

function proposalAnchorOpinion(
  opinions: readonly AnalystOpinion[],
): { opinion: AnalystOpinion; createdAnyway: boolean } | null {
  const supporting = opinions.find((opinion) => opinion.verdict === 'support');
  if (supporting) return { opinion: supporting, createdAnyway: false };

  const strongestCaution = [...opinions].sort((a, b) => b.confidence - a.confidence)[0] ?? null;
  return strongestCaution ? { opinion: strongestCaution, createdAnyway: true } : null;
}

export function canCreateGrillProposal(
  analysis: GrillAnalysisResult | null,
  busy: ProposalBusyState,
): boolean {
  return analysis !== null && busy !== 'proposal';
}

export function buildGrillProposalRequest(analysis: GrillAnalysisResult): GrillProposalRequest {
  return {
    assetId: analysis.assetId,
    idea: analysis.idea,
    analystIds: analysis.opinions.map((opinion) => opinion.analystId),
  };
}

export function buildGrillProposalAnalysis(input: {
  result: GrillAnalysisResult;
  latestPrice?: number;
}): BaseMarketAnalysis | null {
  const anchor = proposalAnchorOpinion(input.result.opinions);
  if (!anchor) return null;

  const { opinion, createdAnyway } = anchor;
  const priceAtAnalysis = input.latestPrice ?? opinion.indicators.ma20;
  const confidence = createdAnyway
    ? Math.max(0.7, Math.min(0.78, opinion.confidence))
    : Math.max(0.7, Math.min(0.9, opinion.confidence));

  return {
    assetId: input.result.assetId,
    action: 'BUY',
    confidence,
    rationale: createdAnyway
      ? `Created anyway after no supporting Analyst Opinion. Strongest caution: ${opinion.thesis}`
      : opinion.thesis,
    what_changed: `Grill Idea: ${input.result.idea}`,
    why_this_trade: createdAnyway
      ? `Create-anyway review: ${opinion.setupEntry}`
      : opinion.setupEntry,
    priceAtAnalysis,
    suggestedTriggerPrice: priceAtAnalysis * 0.997,
    suggestedTakeProfitPrice: priceAtAnalysis * 1.04,
    suggestedStopLossPrice: priceAtAnalysis * 0.94,
    indicators: opinion.indicators,
  };
}
