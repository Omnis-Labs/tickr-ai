import type { Proposal } from '@hunch-it/shared';

const PROPOSAL_NUMBER_KEYS = [
  'suggestedSizeUsd',
  'suggestedTriggerPrice',
  'suggestedTakeProfitPrice',
  'suggestedStopLossPrice',
  'confidence',
  'priceAtProposal',
] as const satisfies readonly (keyof Proposal)[];

const POSITION_IMPACT_NUMBER_KEYS = [
  'weight_before',
  'weight_after',
  'cash_after',
  'sector_before',
  'sector_after',
] as const;

const PROPOSAL_ACTIONS = new Set(['BUY', 'SELL']);
const PROPOSAL_STATUSES = new Set(['ACTIVE', 'SKIPPED', 'EXECUTED', 'EXPIRED']);

function finiteNumber(value: unknown): number | unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value : value;
  if (typeof value === 'string' && value.trim() !== '') {
    const next = Number(value);
    return Number.isFinite(next) ? next : value;
  }
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toNumber?: unknown }).toNumber === 'function'
  ) {
    const next = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(next) ? next : value;
  }
  return value;
}

function isoString(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : value;
}

function hasFiniteNumbers(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof record[key] === 'number' && Number.isFinite(record[key]));
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === 'string' && record[key].length > 0;
}

export function normalizeProposalForClient(value: unknown): Proposal | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const candidate: Record<string, unknown> = { ...source };

  for (const key of PROPOSAL_NUMBER_KEYS) {
    candidate[key] = finiteNumber(source[key]);
  }

  if (source.positionImpact && typeof source.positionImpact === 'object') {
    const impactSource = source.positionImpact as Record<string, unknown>;
    const impact: Record<string, unknown> = { ...impactSource };
    for (const key of POSITION_IMPACT_NUMBER_KEYS) {
      impact[key] = finiteNumber(impactSource[key]);
    }
    candidate.positionImpact = impact;
  }

  candidate.expiresAt = isoString(source.expiresAt);
  candidate.createdAt = isoString(source.createdAt);

  if (
    !hasString(candidate, 'id') ||
    !hasString(candidate, 'userId') ||
    !hasString(candidate, 'ticker') ||
    !hasString(candidate, 'rationale') ||
    !hasString(candidate, 'expiresAt') ||
    !hasString(candidate, 'createdAt') ||
    !PROPOSAL_ACTIONS.has(String(candidate.action)) ||
    !PROPOSAL_STATUSES.has(String(candidate.status)) ||
    !hasFiniteNumbers(candidate, PROPOSAL_NUMBER_KEYS)
  ) {
    return null;
  }

  if (!candidate.reasoning || typeof candidate.reasoning !== 'object') return null;
  if (!candidate.positionImpact || typeof candidate.positionImpact !== 'object') return null;
  if (
    !hasFiniteNumbers(
      candidate.positionImpact as Record<string, unknown>,
      POSITION_IMPACT_NUMBER_KEYS,
    )
  ) {
    return null;
  }

  return candidate as Proposal;
}

export function normalizeProposalsForClient(values: unknown[]): Proposal[] {
  const out: Proposal[] = [];
  for (const value of values) {
    const proposal = normalizeProposalForClient(value);
    if (proposal) out.push(proposal);
  }
  return out;
}
