'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  awardDeskXp,
  buyDeskDecoration,
  createInitialDeskGrowthState,
  DESK_DECORATION_ITEMS,
  levelUpAnalyst,
  recruitQuantAnalyst,
  type AnalystId,
  type DecorationId,
  type DeskGrowthState,
} from './state';
import {
  DESK_GROWTH_STORAGE_EVENT,
  readDeskGrowthState,
  writeDeskGrowthState,
} from './client-store';
import { runEffects } from '@/lib/notifications/effects';
import { deskGrowthFeedbackHandler, type DeskGrowthFeedback } from '@/lib/notifications/registry';

export const DESK_GROWTH_CELEBRATION_EVENT = 'hunch:desk-growth:celebration';
const deskGrowthFeedbackNotifications = new Map<string, Notification>();
const analystLabels: Record<AnalystId, string> = {
  junior: 'Junior Analyst',
  quant: 'Quant Analyst',
};

export interface DeskGrowthCelebrationDetail {
  id: string;
  label: string;
  kind: 'analyst-recruited' | 'analyst-leveled' | 'decoration-bought';
  origin: DeskGrowthCelebrationOrigin;
}

export interface DeskGrowthCelebrationOrigin {
  x: number;
  y: number;
}

function eventId(kind: string, id: string): string {
  return `${kind}:${id}`;
}

function emitDeskGrowthFeedback(feedback: DeskGrowthFeedback) {
  runEffects(deskGrowthFeedbackHandler(feedback), {
    navigate: (href) => {
      window.location.href = href;
    },
    activeNotifs: deskGrowthFeedbackNotifications,
  });
}

function fallbackCelebrationOrigin(): DeskGrowthCelebrationOrigin {
  return {
    x: window.innerWidth / 2,
    y: window.innerHeight * 0.72,
  };
}

function normalizeCelebrationOrigin(
  origin: DeskGrowthCelebrationOrigin | undefined,
): DeskGrowthCelebrationOrigin {
  if (origin && Number.isFinite(origin.x) && Number.isFinite(origin.y)) return origin;
  return fallbackCelebrationOrigin();
}

function emitDeskGrowthCelebration(
  detail: Omit<DeskGrowthCelebrationDetail, 'id' | 'origin'> & {
    origin?: DeskGrowthCelebrationOrigin;
  },
) {
  window.dispatchEvent(
    new CustomEvent<DeskGrowthCelebrationDetail>(DESK_GROWTH_CELEBRATION_EVENT, {
      detail: {
        ...detail,
        id: `${detail.kind}:${Date.now()}`,
        origin: normalizeCelebrationOrigin(detail.origin),
      },
    }),
  );
}

export function useDeskGrowth() {
  const [state, setState] = useState<DeskGrowthState>(() => createInitialDeskGrowthState());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(readDeskGrowthState());
    setHydrated(true);

    const handleStorage = () => setState(readDeskGrowthState());
    window.addEventListener('storage', handleStorage);
    window.addEventListener(DESK_GROWTH_STORAGE_EVENT, handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(DESK_GROWTH_STORAGE_EVENT, handleStorage);
    };
  }, []);

  const update = useCallback((nextState: DeskGrowthState) => {
    setState(nextState);
    writeDeskGrowthState(nextState);
  }, []);

  const awardProposalReview = useCallback(
    (proposalId: string) => {
      const result = awardDeskXp(readDeskGrowthState(), {
        eventId: eventId('proposal-review', proposalId),
        xp: 10,
      });
      if (result.awarded) {
        update(result.state);
        emitDeskGrowthFeedback({
          kind: 'xp-awarded',
          xp: 10,
          reason: 'proposal-review',
        });
      }
      return result.awarded;
    },
    [update],
  );

  const awardProposalSkip = useCallback(
    (proposalId: string, withFeedback: boolean) => {
      const result = awardDeskXp(readDeskGrowthState(), {
        eventId: eventId('proposal-skip', proposalId),
        xp: withFeedback ? 20 : 10,
      });
      if (result.awarded) {
        update(result.state);
        emitDeskGrowthFeedback({
          kind: 'xp-awarded',
          xp: withFeedback ? 20 : 10,
          reason: withFeedback ? 'proposal-skip-feedback' : 'proposal-skip',
        });
      }
      return result.awarded;
    },
    [update],
  );

  const awardProposalAccept = useCallback(
    (proposalId: string) => {
      const result = awardDeskXp(readDeskGrowthState(), {
        eventId: eventId('proposal-accept', proposalId),
        xp: 30,
      });
      if (result.awarded) {
        update(result.state);
        emitDeskGrowthFeedback({
          kind: 'xp-awarded',
          xp: 30,
          reason: 'proposal-accept',
        });
      }
      return result.awarded;
    },
    [update],
  );

  const recruitQuant = useCallback(
    (origin?: DeskGrowthCelebrationOrigin) => {
      const result = recruitQuantAnalyst(readDeskGrowthState());
      if (result.recruited) {
        update(result.state);
        emitDeskGrowthCelebration({
          kind: 'analyst-recruited',
          label: `${analystLabels.quant} recruited`,
          origin,
        });
      }
      return result.recruited;
    },
    [update],
  );

  const levelUp = useCallback(
    (analystId: AnalystId, origin?: DeskGrowthCelebrationOrigin) => {
      const currentState = readDeskGrowthState();
      const result = levelUpAnalyst(currentState, analystId);
      if (result.leveled) {
        const nextLevel = result.state.analysts[analystId].level;
        update(result.state);
        emitDeskGrowthCelebration({
          kind: 'analyst-leveled',
          label: `${analystLabels[analystId]} reached Lv ${nextLevel}`,
          origin,
        });
      }
      return result.leveled;
    },
    [update],
  );

  const buyDecoration = useCallback(
    (decorationId: DecorationId, origin?: DeskGrowthCelebrationOrigin) => {
      const result = buyDeskDecoration(readDeskGrowthState(), decorationId);
      if (result.bought) {
        const decoration = DESK_DECORATION_ITEMS[decorationId];
        update(result.state);
        emitDeskGrowthCelebration({
          kind: 'decoration-bought',
          label: `${decoration.name} installed`,
          origin,
        });
      }
      return result.bought;
    },
    [update],
  );

  return {
    state,
    hydrated,
    awardProposalReview,
    awardProposalSkip,
    awardProposalAccept,
    recruitQuant,
    levelUp,
    buyDecoration,
  };
}
