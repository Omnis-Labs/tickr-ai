import type { GrillAnalysisResult } from './analysis';

export const GRILL_ANALYSIS_DRAFT_TTL_MS = 10 * 60_000;

export interface GrillAnalysisDraftRequest {
  assetId: string;
  idea: string;
  analystIds?: readonly string[];
}

interface GrillAnalysisDraftEntry {
  analysis: GrillAnalysisResult;
  expiresAtMs: number;
}

const drafts = new Map<string, GrillAnalysisDraftEntry>();

function draftKey(input: { userId: string; request: GrillAnalysisDraftRequest }): string {
  return JSON.stringify({
    userId: input.userId,
    assetId: input.request.assetId,
    idea: input.request.idea,
    analystIds: input.request.analystIds ?? null,
  });
}

export function saveGrillAnalysisDraft(input: {
  userId: string;
  request: GrillAnalysisDraftRequest;
  analysis: GrillAnalysisResult;
  nowMs?: () => number;
}): void {
  const nowMs = input.nowMs ?? Date.now;
  drafts.set(draftKey(input), {
    analysis: input.analysis,
    expiresAtMs: nowMs() + GRILL_ANALYSIS_DRAFT_TTL_MS,
  });
}

export function consumeGrillAnalysisDraft(input: {
  userId: string;
  request: GrillAnalysisDraftRequest;
  nowMs?: () => number;
}): GrillAnalysisResult | null {
  const key = draftKey(input);
  const draft = drafts.get(key);
  if (!draft) return null;

  if (draft.expiresAtMs <= (input.nowMs ?? Date.now)()) {
    drafts.delete(key);
    return null;
  }

  drafts.delete(key);
  return draft.analysis;
}

export function clearGrillAnalysisDraftsForTests(): void {
  drafts.clear();
}
