// v1.3 transition: legacy Signal table is gone. Back-evaluation will be
// rewritten against the new Proposal table in Phase B. Until then this is a
// no-op stub so the cron loop in index.ts keeps booting cleanly.

import type { PrismaClient } from '@prisma/client';

export interface EvaluationSummary {
  evaluated: number;
  skipped: number;
  errors: number;
}

export async function evaluatePendingSignals(_prisma: PrismaClient): Promise<EvaluationSummary> {
  // TODO (Phase B): reimplement against `prisma.proposal.findMany({ where:
  //   { evaluatedAt: null, createdAt: { lte: now-1h } } })` and update
  //   `priceAfter / pctChange / outcome` per spec §Back-evaluation.
  return { evaluated: 0, skipped: 0, errors: 0 };
}
