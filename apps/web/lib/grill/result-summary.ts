import type { AnalystOpinion, AnalystVerdict } from './analysis';

export interface GrillVerdictCounts extends Record<AnalystVerdict, number> {
  total: number;
}

export interface GrillResultPresentation {
  counts: GrillVerdictCounts;
  summaryLine: string;
  guidance: string;
  proposalActionLabel: string;
  proposalBody: string;
}

interface GrillResultSummaryInput {
  opinions: readonly Pick<AnalystOpinion, 'verdict'>[];
}

export function getGrillVerdictCounts(
  opinions: readonly Pick<AnalystOpinion, 'verdict'>[],
): GrillVerdictCounts {
  const counts: GrillVerdictCounts = {
    total: opinions.length,
    support: 0,
    challenge: 0,
    reject: 0,
  };

  for (const opinion of opinions) {
    counts[opinion.verdict] += 1;
  }

  return counts;
}

export function buildGrillResultPresentation(
  analysis: GrillResultSummaryInput,
): GrillResultPresentation {
  const counts = getGrillVerdictCounts(analysis.opinions);
  const supportViews = `${counts.support} analyst view${counts.support === 1 ? '' : 's'}`;
  const supportVerb = counts.support === 1 ? 'supports' : 'support';
  const hasSupport = counts.support > 0;

  return {
    counts,
    summaryLine: `${counts.total} analyst view${counts.total === 1 ? '' : 's'}: ${counts.support} support, ${counts.challenge} challenge, ${counts.reject} reject.`,
    guidance:
      'These are analyst perspectives. Use the strongest notes below to decide whether the idea deserves a full proposal.',
    proposalActionLabel: hasSupport ? 'Create proposal' : 'Create proposal anyway',
    proposalBody: hasSupport
      ? `${supportViews} ${supportVerb} turning this into one proposal. You can still edit size, trigger, and risk controls before approving.`
      : 'No analyst supports this idea. You can still create a proposal anyway and review size, trigger, and risk controls before approving.',
  };
}
