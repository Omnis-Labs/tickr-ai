'use client';

import type { Proposal } from '@hunch-it/shared';
import type { UIEffect } from './effects';

/**
 * Notification handlers take an event payload + small ambient context and
 * return a flat list of UIEffects (toast / attention) to run. Adding a new
 * notification source = one new handler entry; the driver doesn't change.
 */

export interface HandlerCtx {
  /** True when document.hidden — handler may surface attention vs in-tab toast. */
  isHidden: boolean;
}

export const proposalNewHandler = (proposal: Proposal, ctx: HandlerCtx): UIEffect[] => {
  const verb = proposal.action === 'SELL' ? 'SELL' : 'BUY';
  const href = `/proposals/${proposal.id}`;

  if (!ctx.isHidden) {
    return [
      {
        kind: 'toast',
        message: `${verb} ${proposal.ticker}`,
        description: proposal.rationale.slice(0, 140),
        action: { label: 'Review', onClick: () => navigateTo(href) },
        durationMs: 12_000,
      },
    ];
  }

  return [
    {
      kind: 'attention',
      title: `${verb} ${proposal.ticker}`,
      body: proposal.rationale,
      tag: proposal.id,
      href,
    },
  ];
};

export interface DeskGrowthFeedback {
  kind: 'xp-awarded';
  xp: number;
  reason: 'proposal-review' | 'proposal-skip' | 'proposal-skip-feedback' | 'proposal-accept';
}

const xpAwardDescriptions: Record<DeskGrowthFeedback['reason'], string> = {
  'proposal-review': 'Proposal reviewed. Keep the desk sharp.',
  'proposal-skip': 'Proposal skipped. Discipline counts.',
  'proposal-skip-feedback': 'Feedback logged. Your desk learned from the pass.',
  'proposal-accept': 'Order staged. Your desk got stronger.',
};

export function deskGrowthFeedbackHandler(feedback: DeskGrowthFeedback): UIEffect[] {
  return [
    {
      kind: 'toast',
      variant: 'success',
      message: `+${feedback.xp} Desk EXP`,
      description: xpAwardDescriptions[feedback.reason],
      action: { label: 'Open room', onClick: () => navigateTo('/room') },
      durationMs: 6_000,
    },
  ];
}

// Lightweight router shim so handlers stay pure of React imports. The driver
// patches `_navigateTo` once on mount via setNavigator(); handlers call
// navigateTo() and the driver's actual router.push is dispatched.
let _navigateTo: ((href: string) => void) | null = null;

export function setNavigator(fn: (href: string) => void): void {
  _navigateTo = fn;
}

function navigateTo(href: string): void {
  if (_navigateTo) _navigateTo(href);
  else window.location.href = href;
}
