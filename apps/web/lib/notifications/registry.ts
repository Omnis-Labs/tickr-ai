'use client';

import type { DemoProposalShape } from '@hunch-it/shared';
import type { PositionUpdatedPayload } from '@/lib/shared-worker/use-shared-worker';
import type { UIEffect } from './effects';

/**
 * Notification handlers — one per socket event type. Handlers take the
 * incoming payload + a small ambient context and return a flat list of
 * UIEffects (toast / attention) to run. Adding a new event = one new entry
 * here; the driver doesn't change.
 */

export interface HandlerCtx {
  /** True when document.hidden — handler may surface attention vs in-tab toast. */
  isHidden: boolean;
}

export const proposalNewHandler = (
  proposal: DemoProposalShape,
  ctx: HandlerCtx,
): UIEffect[] => {
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

export const positionUpdatedHandler = (
  payload: PositionUpdatedPayload,
): UIEffect[] => {
  if (payload.action === 'sibling-cancelled') {
    return [{ kind: 'toast', variant: 'success', message: 'OCO sibling auto-cancelled.' }];
  }
  if (payload.action === 'cancel-sibling' && payload.siblingKind) {
    const kindLabel = payload.siblingKind === 'TAKE_PROFIT' ? 'TP' : 'SL';
    return [
      {
        kind: 'toast',
        message: `OCO: ${kindLabel} still parked in vault.`,
        description: 'Open Position Detail to sign the withdrawal.',
        action: {
          label: 'Open',
          onClick: () => navigateTo(`/positions/${payload.positionId}`),
        },
      },
    ];
  }
  return [];
};

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
