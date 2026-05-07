import type { Proposal } from '@hunch-it/shared';

export function proposalExpiresAtMs(proposal: Pick<Proposal, 'expiresAt'>): number {
  const ms = new Date(proposal.expiresAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

export function isProposalExpired(
  proposal: Pick<Proposal, 'expiresAt'>,
  nowMs = Date.now(),
): boolean {
  return proposalExpiresAtMs(proposal) <= nowMs;
}

export function isLiveProposal(
  proposal: Pick<Proposal, 'expiresAt' | 'status'>,
  nowMs = Date.now(),
): boolean {
  return proposal.status === 'ACTIVE' && !isProposalExpired(proposal, nowMs);
}
